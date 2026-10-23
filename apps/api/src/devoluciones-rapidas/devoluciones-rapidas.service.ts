import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Inventario } from "@prisma/client";

import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { describeNode } from "../node-identity/node-identity";
import { NodeIdentityService } from "../node-identity/node-identity.service";
import { PrismaService } from "../prisma/prisma.service";
import { fetchWithTimeout } from "../shared/fetch-with-timeout.util";
import { syncHealthRegistry } from "../shared/sync-health.registry";
import { UserView } from "../users/user-view.util";
import { CreateDevolucionRapidaDto, CreateDevolucionRapidaLineDto } from "./dto/create-devolucion-rapida.dto";
import { FindDevolucionesRapidasDto } from "./dto/find-devoluciones-rapidas.dto";

// Devolucion rapida: es una transferencia "al reves".
//
// 1. La BODEGA la registra (Status 0), la puede editar/eliminar y la aprueba (Status 1). Al
//    registrarla NO se toca inventario en ningun lado.
// 2. Al aprobar, el paquete DEVRAPIDA_REGISTERED viaja por el VPS a la gemela de la tienda,
//    igual que una transferencia. La tienda lo baja en "Carga de devolucion rapida".
// 3. Cuando la tienda la carga se le RESTA la mercancia (bloqueado si no alcanza la
//    existencia) y se envia DEVRAPIDA_CONFIRMED de vuelta a la gemela de la bodega.
// 4. La bodega baja esa confirmacion y recien ahi SUMA la mercancia (Status 2). Asi la
//    mercancia nunca queda contada en los dos lados.
//
// Sincronizacion propia (DEVRAPIDA_SYNC_OUTBOX/INBOX), separada de la de transferencias; la
// ruta a cada nodo sale de node-identity + SYNC_NODES, igual que en transferencias.

const DEVRAPIDA_SYNC_REQUEST_TIMEOUT_MS = 20000;
const DEVRAPIDA_SYNC_SCHEMA_VERSION = 1;
const DEVRAPIDA_EVENT_REGISTERED = "DEVRAPIDA_REGISTERED";
const DEVRAPIDA_EVENT_CONFIRMED = "DEVRAPIDA_CONFIRMED";
const SYNC_STATUS_PENDING = "PENDING";
const SYNC_STATUS_SENT = "SENT";
const SYNC_STATUS_RECEIVED = "RECEIVED";
const SYNC_STATUS_APPLIED = "APPLIED";
const SYNC_STATUS_ERROR = "ERROR";
const DEVRAPIDA_STATUS_PENDIENTE = 0;
const DEVRAPIDA_STATUS_ENVIADA = 1;
const DEVRAPIDA_STATUS_CONFIRMADA = 2;
const DEFAULT_AUTO_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_AUTO_RETRY_STARTUP_DELAY_MS = 8_000;
const DEFAULT_AUTO_RETRY_LIMIT = 25;
const DEFAULT_MAX_ATTEMPTS = 10;
const SYNC_HEALTH_KEY = "devoluciones-rapidas";
const ZERO = new Prisma.Decimal(0);
// Una devolucion de 500 articulos son 500 updates de inventario: los 5 s por defecto de
// Prisma no alcanzan en una PC lenta.
const LARGE_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 15_000,
  timeout: 60_000,
};
// En Serializable, PostgreSQL aborta una de dos transacciones que se cruzan (40001), por
// ejemplo "Cargar" mientras el ciclo automatico baja paquetes. Se reintenta entera.
const SERIALIZATION_RETRIES = 4;

type DevRapidaTransactionClient = Prisma.TransactionClient;
type DbClient = PrismaService | DevRapidaTransactionClient;

type DevRapidaRow = {
  Numero: number;
  Fecha: Date;
  CodigoBodega: string;
  CodigoTienda: string;
  Observacion: string;
  TotalValor: Prisma.Decimal;
  Status: number;
  Usuario: string;
  FechaAprobacion: Date | null;
  FechaConfirmacion: Date | null;
  UsuarioConfirma: string | null;
};

type DevRapidaLineRow = {
  Numero: number;
  Item: number;
  CodigoBarra: string;
  Referencia: string;
  CodigoMarca: string;
  Nombre: string;
  Cantidad: Prisma.Decimal;
  Valor: Prisma.Decimal;
};

type OutboxRow = {
  GlobalId: string;
  EventType: string;
  NumeroOrigen: number;
  CodigoBodega: string;
  CodigoTienda: string;
  DestinationCode: string;
  Payload: unknown;
  Status: string;
  CreatedAt: Date;
  SentAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type InboxRow = {
  GlobalId: string;
  EventType: string;
  NumeroOrigen: number;
  CodigoBodega: string;
  CodigoTienda: string;
  Payload: unknown;
  Status: string;
  ReceivedAt: Date;
  AppliedAt: Date | null;
  AppliedBy: string | null;
  Attempts: number;
  LastError: string | null;
};

type SyncNodeRow = {
  NodeId: string;
  SucursalCodigo: string;
  ApiUrl: string | null;
};

type RegisteredLinePayload = {
  item: number;
  codigoBarra: string;
  referencia: string;
  codigoMarca: string;
  nombre: string;
  cantidad: string;
  valor: string;
};

type RegisteredPayload = {
  schemaVersion: number;
  eventType: typeof DEVRAPIDA_EVENT_REGISTERED;
  globalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  devolucion: {
    numero: number;
    fecha: string;
    fechaAprobacion: string;
    codigoBodega: string;
    codigoTienda: string;
    observacion: string;
    totalValor: string;
    usuario: string;
  };
  items: RegisteredLinePayload[];
};

type ConfirmedPayload = {
  schemaVersion: number;
  eventType: typeof DEVRAPIDA_EVENT_CONFIRMED;
  globalId: string;
  registeredGlobalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  devolucion: {
    numero: number;
    codigoBodega: string;
    codigoTienda: string;
    fechaCarga: string;
    usuarioCarga: string;
  };
  items: Array<{ item: number; codigoBarra: string; cantidad: string }>;
};

type SyncPayload = RegisteredPayload | ConfirmedPayload;

type NormalizedLine = {
  item: number;
  codigoBarra: string;
  referencia: string;
  codigoMarca: string;
  nombre: string;
  cantidad: Prisma.Decimal;
  valor: Prisma.Decimal;
};

@Injectable()
export class DevolucionesRapidasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevolucionesRapidasService.name);
  private autoRetryTimer: ReturnType<typeof setInterval> | null = null;
  private autoRetryStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRetryInProgress = false;
  // El ciclo automatico y un "Buscar"/pull manual pueden querer sumar la misma confirmacion a
  // la vez; se aplican de a una para no chocar en la transaccion serializable.
  private confirmationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mirrorSyncService: MirrorSyncService,
    private readonly nodeIdentity: NodeIdentityService,
  ) {}

  async onModuleInit() {
    // Si la base no deja crear las tablas (ej. permisos del usuario "rocky" en una gemela),
    // la devolucion rapida queda sin funcionar pero el API arranca y la tienda sigue vendiendo.
    try {
      await this.ensureSchema();
    } catch (error) {
      this.logger.error(
        `No se pudieron crear las tablas de devolucion rapida; el modulo queda deshabilitado: ${this.extractErrorMessage(error)}`,
      );
      return;
    }

    this.startAutoRetry();
  }

  onModuleDestroy() {
    if (this.autoRetryStartupTimer) {
      clearTimeout(this.autoRetryStartupTimer);
      this.autoRetryStartupTimer = null;
    }

    if (this.autoRetryTimer) {
      clearInterval(this.autoRetryTimer);
      this.autoRetryTimer = null;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Bodega: registro
  // ---------------------------------------------------------------------------------------

  async getMetadata() {
    const identity = this.nodeIdentity.get();
    const sucursales = await this.prisma.sucursales.findMany({
      orderBy: [{ Status: "desc" }, { Codigo: "asc" }],
    });

    return {
      nodo: {
        nodeId: identity.nodeId,
        sucursalCodigo: identity.sucursalCodigo,
        role: identity.role,
        esVps: identity.isVpsInstance,
        conflicto: identity.conflict,
      },
      puedeRegistrar: this.canRegisterHere(),
      tiendas: sucursales
        .filter((item) => describeNode(item.Codigo)?.role === "tienda")
        .map((item) => ({
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status,
        })),
    };
  }

  async search(findDto: FindDevolucionesRapidasDto) {
    const limit = findDto.limit ?? 50;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (findDto.status !== undefined) {
      params.push(findDto.status);
      conditions.push(`d."Status" = $${params.length}`);
    }

    const buscar = String(findDto.buscar || "").trim().toUpperCase();
    if (buscar) {
      params.push(`%${buscar}%`);
      conditions.push(
        `(cast(d."Numero" as text) like $${params.length} or upper(d."CodigoTienda") like $${params.length} or upper(d."Observacion") like $${params.length})`,
      );
    }

    params.push(limit);
    const rows = await this.prisma.$queryRawUnsafe<Array<DevRapidaRow & { Lineas: number; CantidadTotal: Prisma.Decimal | null }>>(
      `
        select
          d.*,
          (select count(*)::int from dbo."MOVDEVRAPIDA" m where m."Numero" = d."Numero") as "Lineas",
          (select sum(m."Cantidad") from dbo."MOVDEVRAPIDA" m where m."Numero" = d."Numero") as "CantidadTotal"
        from dbo."DEVRAPIDA" d
        ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
        order by d."Numero" desc
        limit $${params.length}
      `,
      ...params,
    );

    const [names, syncRows] = await Promise.all([
      this.loadSucursalNames(rows.flatMap((row) => [row.CodigoBodega, row.CodigoTienda])),
      this.loadRegisteredOutboxRows(rows.map((row) => row.Numero)),
    ]);

    return {
      items: rows.map((row) => ({
        ...this.toHeaderView(row, names, syncRows.get(row.Numero) ?? null),
        lineas: row.Lineas,
        cantidadTotal: (row.CantidadTotal ?? ZERO).toString(),
      })),
    };
  }

  async findOne(numero: number) {
    return {
      devolucion: await this.findDetailOrThrow(this.prisma, numero),
    };
  }

  async create(createDto: CreateDevolucionRapidaDto, user: UserView) {
    const origen = this.assertCanRegisterHere();
    const codigoTienda = this.normalizeStoreCode(createDto.codigoTienda);

    const devolucion = await this.runSerializable(
      async (tx) => {
        const lines = await this.normalizeLines(tx, createDto.items);
        const numero = await this.getNextNumber(tx);
        const totalValor = this.computeTotal(lines);

        await tx.$executeRawUnsafe(
          `
            insert into dbo."DEVRAPIDA"
              ("Numero", "Fecha", "CodigoBodega", "CodigoTienda", "Observacion", "TotalValor", "Status", "Usuario")
            values ($1, now(), $2, $3, $4, $5::numeric, $6, $7)
          `,
          numero,
          origen,
          codigoTienda,
          String(createDto.observacion || "").trim(),
          totalValor.toString(),
          DEVRAPIDA_STATUS_PENDIENTE,
          this.normalizeUsuario(user),
        );
        await this.insertLines(tx, numero, lines);

        return this.findDetailOrThrow(tx, numero);
      },
    );

    return { devolucion };
  }

  async update(numero: number, updateDto: CreateDevolucionRapidaDto) {
    this.assertCanRegisterHere();
    const codigoTienda = this.normalizeStoreCode(updateDto.codigoTienda);

    const devolucion = await this.runSerializable(
      async (tx) => {
        const existing = await this.findHeaderOrThrow(tx, numero);
        if (existing.Status !== DEVRAPIDA_STATUS_PENDIENTE) {
          throw new ConflictException("La devolucion rapida ya fue aprobada y no puede editarse.");
        }

        const lines = await this.normalizeLines(tx, updateDto.items);
        const totalValor = this.computeTotal(lines);

        await tx.$executeRawUnsafe(
          `
            update dbo."DEVRAPIDA"
            set "CodigoTienda" = $2, "Observacion" = $3, "TotalValor" = $4::numeric
            where "Numero" = $1
          `,
          numero,
          codigoTienda,
          String(updateDto.observacion || "").trim(),
          totalValor.toString(),
        );
        await tx.$executeRawUnsafe(`delete from dbo."MOVDEVRAPIDA" where "Numero" = $1`, numero);
        await this.insertLines(tx, numero, lines);

        return this.findDetailOrThrow(tx, numero);
      },
    );

    return { devolucion };
  }

  async remove(numero: number) {
    await this.runSerializable(
      async (tx) => {
        const existing = await this.findHeaderOrThrow(tx, numero);
        if (existing.Status !== DEVRAPIDA_STATUS_PENDIENTE) {
          throw new ConflictException("La devolucion rapida ya fue aprobada y no puede eliminarse.");
        }

        await tx.$executeRawUnsafe(`delete from dbo."MOVDEVRAPIDA" where "Numero" = $1`, numero);
        await tx.$executeRawUnsafe(`delete from dbo."DEVRAPIDA" where "Numero" = $1`, numero);
      },
    );

    return { deleted: true, numero };
  }

  async approve(numero: number) {
    this.assertCanRegisterHere();

    const devolucion = await this.runSerializable(
      async (tx) => {
        const existing = await this.findHeaderOrThrow(tx, numero);
        if (existing.Status !== DEVRAPIDA_STATUS_PENDIENTE) {
          throw new ConflictException("La devolucion rapida ya fue aprobada.");
        }

        const lines = await this.getLines(tx, numero);
        if (lines.length === 0) {
          throw new BadRequestException("La devolucion rapida no tiene renglones para aprobar.");
        }

        // Igual que al aprobar una transferencia: el valor de cada linea se refresca con el
        // costo vigente del articulo en la bodega.
        const inventory = await this.loadInventoryByCode(tx, lines.map((line) => line.CodigoBarra));
        let totalValor = ZERO;
        for (const line of lines) {
          const article = inventory.get(line.CodigoBarra);
          const valor = article ? this.resolveLineValue(article) : line.Valor;
          totalValor = totalValor.plus(valor.mul(line.Cantidad));
          await tx.$executeRawUnsafe(
            `update dbo."MOVDEVRAPIDA" set "Valor" = $3::numeric where "Numero" = $1 and "Item" = $2`,
            numero,
            line.Item,
            valor.toString(),
          );
        }

        await tx.$executeRawUnsafe(
          `
            update dbo."DEVRAPIDA"
            set "Status" = $2, "FechaAprobacion" = now(), "TotalValor" = $3::numeric
            where "Numero" = $1
          `,
          numero,
          DEVRAPIDA_STATUS_ENVIADA,
          totalValor.toString(),
        );

        await this.recordRegisteredOutbox(tx, numero);
        return this.findDetailOrThrow(tx, numero);
      },
    );

    const sync = await this.pushOutboxSafely({ numero, eventType: DEVRAPIDA_EVENT_REGISTERED });

    return {
      devolucion: await this.findDetailOrThrow(this.prisma, numero).catch(() => devolucion),
      sync,
    };
  }

  async requeue(numero: number) {
    await this.runSerializable(
      async (tx) => {
        const existing = await this.findHeaderOrThrow(tx, numero);
        if (existing.Status !== DEVRAPIDA_STATUS_ENVIADA) {
          throw new ConflictException("Solo se puede reenviar una devolucion rapida aprobada que la tienda no ha cargado.");
        }

        await this.recordRegisteredOutbox(tx, numero);
      },
    );

    const sync = await this.pushOutboxSafely({ numero, eventType: DEVRAPIDA_EVENT_REGISTERED });
    return {
      devolucion: await this.findDetailOrThrow(this.prisma, numero),
      sync,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Tienda: carga (resta)
  // ---------------------------------------------------------------------------------------

  async searchInbound(findDto: FindDevolucionesRapidasDto) {
    const limit = findDto.limit ?? 50;

    try {
      await this.pullRemote({ limit });
    } catch (error) {
      this.logger.warn(
        `No se pudo refrescar las devoluciones rapidas desde el VPS antes de la consulta: ${this.extractErrorMessage(error)}`,
      );
    }

    const params: unknown[] = [DEVRAPIDA_EVENT_REGISTERED];
    const conditions = [`"EventType" = $1`];

    if (findDto.status === 0) {
      conditions.push(`"Status" <> '${SYNC_STATUS_APPLIED}'`);
    } else if (findDto.status !== undefined) {
      conditions.push(`"Status" = '${SYNC_STATUS_APPLIED}'`);
    }

    const buscar = String(findDto.buscar || "").trim().toUpperCase();
    if (buscar) {
      params.push(`%${buscar}%`);
      conditions.push(
        `(cast("NumeroOrigen" as text) like $${params.length} or upper("CodigoBodega") like $${params.length} or upper("GlobalId") like $${params.length})`,
      );
    }

    params.push(limit);
    const rows = await this.prisma.$queryRawUnsafe<InboxRow[]>(
      `
        select *
        from dbo."DEVRAPIDA_SYNC_INBOX"
        where ${conditions.join(" and ")}
        order by case when "Status" = '${SYNC_STATUS_APPLIED}' then 1 else 0 end, "ReceivedAt" desc
        limit $${params.length}
      `,
      ...params,
    );

    const names = await this.loadSucursalNames(rows.flatMap((row) => [row.CodigoBodega, row.CodigoTienda]));
    return {
      items: rows
        .map((row) => this.toInboundView(row, names))
        .filter((item): item is NonNullable<typeof item> => item !== null),
    };
  }

  async findInboundOne(globalId: string) {
    return {
      devolucion: await this.findInboundDetailOrThrow(this.prisma, this.normalizeGlobalId(globalId)),
    };
  }

  async loadInbound(rawGlobalId: string, user: UserView | null) {
    const globalId = this.normalizeGlobalId(rawGlobalId);

    const result = await this.runSerializable(
      async (tx) => {
        const inbox = await this.getInboxRow(tx, globalId);
        if (!inbox || inbox.EventType !== DEVRAPIDA_EVENT_REGISTERED) {
          throw new NotFoundException("La devolucion rapida recibida no existe en esta tienda.");
        }

        if (inbox.Status === SYNC_STATUS_APPLIED) {
          return {
            loaded: false,
            alreadyLoaded: true,
            message: "La devolucion rapida ya estaba cargada.",
          };
        }

        const payload = this.parseRegisteredPayload(this.parseRawJson(inbox.Payload));
        this.assertPayloadIsForThisStore(payload.devolucion.codigoTienda);

        const quantities = new Map<string, { cantidad: Prisma.Decimal; line: RegisteredLinePayload }>();
        for (const line of payload.items) {
          const current = quantities.get(line.codigoBarra);
          quantities.set(line.codigoBarra, {
            line,
            cantidad: (current?.cantidad ?? ZERO).plus(new Prisma.Decimal(line.cantidad)),
          });
        }

        const inventory = await this.loadInventoryByCode(tx, Array.from(quantities.keys()));
        const problems: string[] = [];

        for (const [codigoBarra, { cantidad, line }] of quantities.entries()) {
          const article = inventory.get(codigoBarra);
          if (!article) {
            problems.push(`${codigoBarra} - ${line.nombre} (no existe en esta tienda)`);
            continue;
          }

          // Misma identidad que transferencias: CodigoBarra + Referencia + CodigoMarca.
          if (!this.sameIdentity(article, line)) {
            problems.push(
              `${codigoBarra} - ${line.nombre} (en esta tienda es ref. ${article.Referencia.trim()} / marca ${article.CodigoMarca.trim()}, ` +
                `la bodega envio ref. ${line.referencia} / marca ${line.codigoMarca})`,
            );
            continue;
          }

          if (article.Existencia.lessThan(cantidad)) {
            problems.push(
              `${codigoBarra} - ${article.Nombre} (disponible ${article.Existencia.toString()}, a devolver ${cantidad.toString()})`,
            );
          }
        }

        if (problems.length > 0) {
          throw new BadRequestException(
            `No se puede cargar la devolucion rapida. Revisa el o los articulos: ${problems.join("; ")}.`,
          );
        }

        const now = new Date();
        for (const [codigoBarra, { cantidad }] of quantities.entries()) {
          const article = inventory.get(codigoBarra)!;
          await tx.inventario.update({
            where: { CodigoBarra: codigoBarra },
            data: {
              Existencia: article.Existencia.minus(cantidad),
              UltimaActualizacion: now,
              FechaPrimerMovimiento: article.FechaPrimerMovimiento ?? now,
            },
          });
        }

        const usuarioCarga = this.normalizeUsuario(user);
        await tx.$executeRawUnsafe(
          `
            update dbo."DEVRAPIDA_SYNC_INBOX"
            set "Status" = $2, "AppliedAt" = now(), "AppliedBy" = $3, "LastError" = null
            where "GlobalId" = $1
          `,
          globalId,
          SYNC_STATUS_APPLIED,
          usuarioCarga,
        );

        await this.recordConfirmedOutbox(tx, payload, usuarioCarga, now);
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, quantities.keys());

        return {
          loaded: true,
          alreadyLoaded: false,
          message: "Devolucion rapida cargada: la mercancia se desconto del inventario de la tienda.",
        };
      },
    );

    const [sync] = await Promise.all([
      result.loaded ? this.pushOutboxSafely({ registeredGlobalId: globalId }) : Promise.resolve(null),
      this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }).catch(() => null),
    ]);

    return {
      ...result,
      sync,
      devolucion: await this.findInboundDetailOrThrow(this.prisma, globalId),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Sincronizacion
  // ---------------------------------------------------------------------------------------

  async listOutbox(status?: string, limit = 50) {
    const normalizedStatus = String(status || "").trim().toUpperCase();
    const rows = await this.prisma.$queryRawUnsafe<OutboxRow[]>(
      `
        select *
        from dbo."DEVRAPIDA_SYNC_OUTBOX"
        ${normalizedStatus ? `where "Status" = $2` : ""}
        order by "CreatedAt" desc
        limit $1
      `,
      limit,
      ...(normalizedStatus ? [normalizedStatus] : []),
    );

    return {
      items: rows.map((row) => ({
        globalId: row.GlobalId,
        eventType: row.EventType,
        numero: row.NumeroOrigen,
        codigoBodega: row.CodigoBodega,
        codigoTienda: row.CodigoTienda,
        destino: row.DestinationCode,
        status: row.Status,
        creado: row.CreatedAt,
        enviado: row.SentAt,
        intentos: row.Attempts,
        ultimoError: row.LastError,
      })),
    };
  }

  async exportInbox(limit = 50) {
    const rows = await this.prisma.$queryRawUnsafe<InboxRow[]>(
      `
        select *
        from dbo."DEVRAPIDA_SYNC_INBOX"
        where "Status" in ($1, $2)
        order by case when "Status" = $1 then 0 else 1 end, coalesce("AppliedAt", "ReceivedAt") desc
        limit $3
      `,
      SYNC_STATUS_RECEIVED,
      SYNC_STATUS_APPLIED,
      limit,
    );

    return {
      processed: rows.length,
      items: rows.map((row) => ({
        globalId: row.GlobalId,
        eventType: row.EventType,
        status: row.Status,
        recibido: row.ReceivedAt,
        aplicado: row.AppliedAt,
        payload: this.parseRawJson(row.Payload),
      })),
    };
  }

  // Lo llama el nodo que envia (POST a la gemela del VPS) y tambien el pull local. Solo
  // registra el paquete: la resta en la tienda la hace un usuario desde "Carga" y la suma en
  // la bodega la hace el ciclo local (nunca la gemela del VPS, que no tiene la devolucion).
  async importPackage(body: Record<string, unknown>) {
    const payload = this.parseSyncPayload(body);

    if (payload.eventType === DEVRAPIDA_EVENT_REGISTERED) {
      this.assertPayloadIsForThisStore(payload.devolucion.codigoTienda);
    } else {
      this.assertPayloadIsForThisWarehouse(payload.devolucion.codigoBodega);
    }

    const existing = await this.getInboxRow(this.prisma, payload.globalId);
    if (existing?.Status === SYNC_STATUS_APPLIED) {
      return {
        imported: false,
        status: SYNC_STATUS_APPLIED,
        globalId: payload.globalId,
        eventType: payload.eventType,
        message: "El paquete ya habia sido aplicado en esta base.",
      };
    }

    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."DEVRAPIDA_SYNC_INBOX"
          ("GlobalId", "EventType", "NumeroOrigen", "CodigoBodega", "CodigoTienda", "Payload", "Status")
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        on conflict ("GlobalId") do update set
          "Payload" = excluded."Payload"
        where dbo."DEVRAPIDA_SYNC_INBOX"."Status" <> $8
      `,
      payload.globalId,
      payload.eventType,
      payload.devolucion.numero,
      payload.devolucion.codigoBodega,
      payload.devolucion.codigoTienda,
      JSON.stringify(payload),
      SYNC_STATUS_RECEIVED,
      SYNC_STATUS_APPLIED,
    );

    return {
      imported: !existing,
      status: SYNC_STATUS_RECEIVED,
      globalId: payload.globalId,
      eventType: payload.eventType,
    };
  }

  async pushPending(limit = 50) {
    this.nodeIdentity.assertSyncIdentity();
    const rows = await this.prisma.$queryRawUnsafe<OutboxRow[]>(
      `
        select *
        from dbo."DEVRAPIDA_SYNC_OUTBOX"
        where "Status" = $1
        order by "CreatedAt" asc
        limit $2
      `,
      SYNC_STATUS_PENDING,
      limit,
    );

    const results = await this.pushRows(rows);
    return { processed: results.length, results };
  }

  async pullRemote(options: { limit?: number } = {}) {
    const remoteApiUrl = this.resolvePullRemoteApiUrl();
    if (!remoteApiUrl) {
      return {
        enabled: false,
        processed: 0,
        imported: 0,
        applied: 0,
        message: "Esta sede no descarga devoluciones rapidas del VPS (es la gemela del VPS o no tiene ruta remota).",
      };
    }

    const limit = options.limit ?? 50;
    const token = await this.loginRemote(remoteApiUrl);
    const response = await fetchWithTimeout(
      `${remoteApiUrl}/api/devoluciones-rapidas/sync/inbox/export?limit=${limit}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      DEVRAPIDA_SYNC_REQUEST_TIMEOUT_MS,
    );
    const body = await this.readRemoteJson(response);

    if (!response.ok || !this.isRecord(body) || !Array.isArray(body.items)) {
      throw new ConflictException(
        `No se pudo descargar las devoluciones rapidas del VPS: ${this.formatRemoteError(body, response.status)}`,
      );
    }

    let imported = 0;
    let processed = 0;
    for (const rawItem of body.items) {
      if (!this.isRecord(rawItem) || !this.isRecord(rawItem.payload)) {
        continue;
      }

      processed += 1;
      try {
        const importResult = await this.importPackage(rawItem.payload);
        if (importResult.imported) {
          imported += 1;
        }

        // Si alguien cargo la devolucion directo en la gemela del VPS, se aplica tambien aqui
        // para que la PC no quede con la mercancia de mas (mismo criterio que transferencias).
        const remoteStatus = String(rawItem.status || "").trim().toUpperCase();
        if (
          remoteStatus === SYNC_STATUS_APPLIED &&
          importResult.eventType === DEVRAPIDA_EVENT_REGISTERED &&
          importResult.status !== SYNC_STATUS_APPLIED
        ) {
          await this.autoLoadAppliedOnVps(importResult.globalId);
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo procesar la devolucion rapida ${String(rawItem.globalId || "")} descargada del VPS: ${this.extractErrorMessage(error)}`,
        );
      }
    }

    const applied = await this.applyPendingConfirmations(limit);
    return { enabled: true, remoteApiUrl, processed, imported, applied };
  }

  // Con tope de intentos, igual que el outbox: si la PC no puede descontarla (ej. sin
  // existencia) no se reintenta cada 30 s para siempre; queda el error y la carga manual.
  private async autoLoadAppliedOnVps(globalId: string) {
    const local = await this.getInboxRow(this.prisma, globalId);
    if (!local || local.Status === SYNC_STATUS_APPLIED || local.Attempts >= this.getMaxAttempts()) {
      return;
    }

    try {
      await this.loadInbound(globalId, null);
    } catch (error) {
      await this.prisma.$executeRawUnsafe(
        `
          update dbo."DEVRAPIDA_SYNC_INBOX"
          set "Attempts" = "Attempts" + 1, "LastError" = $2
          where "GlobalId" = $1 and "Status" <> $3
        `,
        globalId,
        this.extractErrorMessage(error),
        SYNC_STATUS_APPLIED,
      );
      throw error;
    }
  }

  // Bodega local: suma la mercancia de cada devolucion que la tienda confirmo.
  async applyPendingConfirmations(limit = DEFAULT_AUTO_RETRY_LIMIT) {
    if (this.nodeIdentity.get().isVpsInstance) {
      return 0;
    }

    const rows = await this.prisma.$queryRawUnsafe<InboxRow[]>(
      `
        select *
        from dbo."DEVRAPIDA_SYNC_INBOX"
        where "EventType" = $1 and "Status" in ($2, $3) and "Attempts" < $4
        order by "ReceivedAt" asc
        limit $5
      `,
      DEVRAPIDA_EVENT_CONFIRMED,
      SYNC_STATUS_RECEIVED,
      SYNC_STATUS_ERROR,
      this.getMaxAttempts(),
      limit,
    );

    let applied = 0;
    for (const row of rows) {
      try {
        const run = this.confirmationQueue.then(() => this.applyConfirmation(row));
        this.confirmationQueue = run.catch(() => undefined);
        await run;
        applied += 1;
      } catch (error) {
        const message = this.extractErrorMessage(error);
        this.logger.error(`No se pudo sumar en bodega la devolucion rapida ${row.GlobalId}: ${message}`);
        await this.prisma.$executeRawUnsafe(
          `
            update dbo."DEVRAPIDA_SYNC_INBOX"
            set "Status" = $2, "Attempts" = "Attempts" + 1, "LastError" = $3
            where "GlobalId" = $1 and "Status" <> $4
          `,
          row.GlobalId,
          SYNC_STATUS_ERROR,
          message,
          SYNC_STATUS_APPLIED,
        );
      }
    }

    if (applied > 0) {
      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }).catch(() => null);
    }

    return applied;
  }

  private async applyConfirmation(row: InboxRow) {
    const payload = this.parseConfirmedPayload(this.parseRawJson(row.Payload));
    this.assertPayloadIsForThisWarehouse(payload.devolucion.codigoBodega);

    await this.runSerializable(
      async (tx) => {
        const header = await this.findHeader(tx, payload.devolucion.numero);
        if (!header || header.CodigoBodega.toUpperCase() !== payload.devolucion.codigoBodega.toUpperCase()) {
          throw new NotFoundException(
            `La devolucion rapida ${payload.devolucion.numero} no existe en esta bodega.`,
          );
        }

        if (header.Status === DEVRAPIDA_STATUS_CONFIRMADA) {
          await this.markInboxApplied(tx, row.GlobalId, header.UsuarioConfirma);
          return;
        }

        if (header.Status !== DEVRAPIDA_STATUS_ENVIADA) {
          throw new ConflictException(`La devolucion rapida ${header.Numero} no esta aprobada en esta bodega.`);
        }

        // Se suma lo que la bodega registro y aprobo, que es exactamente lo que la tienda resto.
        const lines = await this.getLines(tx, header.Numero);
        const quantities = new Map<string, Prisma.Decimal>();
        for (const line of lines) {
          quantities.set(line.CodigoBarra, (quantities.get(line.CodigoBarra) ?? ZERO).plus(line.Cantidad));
        }

        const inventory = await this.loadInventoryByCode(tx, Array.from(quantities.keys()));
        const missing = Array.from(quantities.keys()).filter((code) => !inventory.has(code));
        if (missing.length > 0) {
          throw new NotFoundException(
            `No se puede sumar la devolucion rapida ${header.Numero}: no existen en la bodega ${missing.join(", ")}.`,
          );
        }

        const now = new Date();
        for (const [codigoBarra, cantidad] of quantities.entries()) {
          const article = inventory.get(codigoBarra)!;
          await tx.inventario.update({
            where: { CodigoBarra: codigoBarra },
            data: {
              Existencia: article.Existencia.plus(cantidad),
              UltimaActualizacion: now,
              FechaPrimerMovimiento: article.FechaPrimerMovimiento ?? now,
            },
          });
        }

        await tx.$executeRawUnsafe(
          `
            update dbo."DEVRAPIDA"
            set "Status" = $2, "FechaConfirmacion" = $3::timestamptz, "UsuarioConfirma" = $4
            where "Numero" = $1
          `,
          header.Numero,
          DEVRAPIDA_STATUS_CONFIRMADA,
          payload.devolucion.fechaCarga,
          payload.devolucion.usuarioCarga.slice(0, 15),
        );
        await this.markInboxApplied(tx, row.GlobalId, payload.devolucion.usuarioCarga.slice(0, 15));
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, quantities.keys());
      },
    );
  }

  private async runSerializable<T>(fn: (tx: DevRapidaTransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, LARGE_TRANSACTION_OPTIONS);
      } catch (error) {
        if (attempt >= SERIALIZATION_RETRIES || !this.isSerializationFailure(error)) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
  }

  private isSerializationFailure(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return true;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /40001|could not serialize|no se pudo serializar/i.test(message);
  }

  private async markInboxApplied(tx: DevRapidaTransactionClient, globalId: string, usuario: string | null) {
    await tx.$executeRawUnsafe(
      `
        update dbo."DEVRAPIDA_SYNC_INBOX"
        set "Status" = $2, "AppliedAt" = now(), "AppliedBy" = $3, "LastError" = null
        where "GlobalId" = $1
      `,
      globalId,
      SYNC_STATUS_APPLIED,
      usuario,
    );
  }

  private async pushOutboxSafely(filter: { numero?: number; eventType?: string; registeredGlobalId?: string }) {
    try {
      this.nodeIdentity.assertSyncIdentity();
      const rows = filter.registeredGlobalId
        ? await this.prisma.$queryRawUnsafe<OutboxRow[]>(
            `select * from dbo."DEVRAPIDA_SYNC_OUTBOX" where "GlobalId" = $1 and "Status" = $2`,
            this.buildConfirmedGlobalId(filter.registeredGlobalId),
            SYNC_STATUS_PENDING,
          )
        : await this.prisma.$queryRawUnsafe<OutboxRow[]>(
            `select * from dbo."DEVRAPIDA_SYNC_OUTBOX" where "NumeroOrigen" = $1 and "EventType" = $2 and "Status" = $3`,
            filter.numero,
            filter.eventType,
            SYNC_STATUS_PENDING,
          );
      const results = await this.pushRows(rows);
      return { processed: results.length, results };
    } catch (error) {
      // El documento ya quedo guardado; el ciclo automatico lo reintenta.
      return { processed: 0, results: [], error: this.extractErrorMessage(error) };
    }
  }

  private async pushRows(rows: OutboxRow[]) {
    const results: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      try {
        const apiUrl = await this.resolvePeerApiUrl(row.DestinationCode);
        if (!apiUrl) {
          throw new ConflictException(`No hay ruta configurada hacia el nodo ${row.DestinationCode}.`);
        }

        const token = await this.loginRemote(apiUrl);
        const response = await fetchWithTimeout(
          `${apiUrl}/api/devoluciones-rapidas/sync/import`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(this.parseRawJson(row.Payload)),
          },
          DEVRAPIDA_SYNC_REQUEST_TIMEOUT_MS,
        );
        const body = await this.readRemoteJson(response);
        if (!response.ok) {
          throw new ConflictException(`El destino rechazo el paquete: ${this.formatRemoteError(body, response.status)}`);
        }

        await this.updateOutboxStatus(row.GlobalId, SYNC_STATUS_SENT, null);
        results.push({ globalId: row.GlobalId, destino: row.DestinationCode, status: SYNC_STATUS_SENT });
      } catch (error) {
        const message = this.extractErrorMessage(error);
        const nextStatus = row.Attempts + 1 >= this.getMaxAttempts() ? SYNC_STATUS_ERROR : SYNC_STATUS_PENDING;
        if (nextStatus === SYNC_STATUS_ERROR) {
          this.logger.error(`Dejando de reintentar ${row.GlobalId} tras ${row.Attempts + 1} intentos: ${message}`);
        } else {
          this.logger.warn(`No se pudo enviar ${row.GlobalId}: ${message}`);
        }

        await this.updateOutboxStatus(row.GlobalId, nextStatus, message);
        results.push({ globalId: row.GlobalId, destino: row.DestinationCode, status: nextStatus, error: message });
      }
    }

    return results;
  }

  private async updateOutboxStatus(globalId: string, status: string, lastError: string | null) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."DEVRAPIDA_SYNC_OUTBOX"
        set
          "Status" = $2,
          "SentAt" = case when $2 = $3 then now() else "SentAt" end,
          "Attempts" = "Attempts" + 1,
          "LastError" = $4
        where "GlobalId" = $1
      `,
      globalId,
      status,
      SYNC_STATUS_SENT,
      lastError,
    );
  }

  private async recordRegisteredOutbox(tx: DevRapidaTransactionClient, numero: number) {
    const header = await this.findHeaderOrThrow(tx, numero);
    const lines = await this.getLines(tx, numero);
    const sourceNodeId = this.selfNodeIdOrThrow();
    const destination = describeNode(header.CodigoTienda);
    const globalId = this.buildRegisteredGlobalId(sourceNodeId, numero);

    const payload: RegisteredPayload = {
      schemaVersion: DEVRAPIDA_SYNC_SCHEMA_VERSION,
      eventType: DEVRAPIDA_EVENT_REGISTERED,
      globalId,
      sourceNodeId,
      destinationNodeId: destination?.nodeId ?? header.CodigoTienda,
      devolucion: {
        numero,
        fecha: header.Fecha.toISOString(),
        fechaAprobacion: (header.FechaAprobacion ?? new Date()).toISOString(),
        codigoBodega: header.CodigoBodega,
        codigoTienda: header.CodigoTienda,
        observacion: header.Observacion,
        totalValor: header.TotalValor.toString(),
        usuario: header.Usuario,
      },
      items: lines.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        referencia: line.Referencia,
        codigoMarca: line.CodigoMarca,
        nombre: line.Nombre,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
      })),
    };

    await this.upsertOutbox(tx, payload, header.CodigoTienda);
  }

  private async recordConfirmedOutbox(
    tx: DevRapidaTransactionClient,
    registered: RegisteredPayload,
    usuarioCarga: string,
    fechaCarga: Date,
  ) {
    const identity = this.nodeIdentity.get();
    const payload: ConfirmedPayload = {
      schemaVersion: DEVRAPIDA_SYNC_SCHEMA_VERSION,
      eventType: DEVRAPIDA_EVENT_CONFIRMED,
      globalId: this.buildConfirmedGlobalId(registered.globalId),
      registeredGlobalId: registered.globalId,
      sourceNodeId: identity.nodeId ?? registered.destinationNodeId,
      destinationNodeId: registered.sourceNodeId,
      devolucion: {
        numero: registered.devolucion.numero,
        codigoBodega: registered.devolucion.codigoBodega,
        codigoTienda: registered.devolucion.codigoTienda,
        fechaCarga: fechaCarga.toISOString(),
        usuarioCarga,
      },
      items: registered.items.map((line) => ({
        item: line.item,
        codigoBarra: line.codigoBarra,
        cantidad: line.cantidad,
      })),
    };

    await this.upsertOutbox(tx, payload, registered.devolucion.codigoBodega);
  }

  private async upsertOutbox(tx: DevRapidaTransactionClient, payload: SyncPayload, destinationCode: string) {
    await tx.$executeRawUnsafe(
      `
        insert into dbo."DEVRAPIDA_SYNC_OUTBOX"
          ("GlobalId", "EventType", "NumeroOrigen", "CodigoBodega", "CodigoTienda", "DestinationCode", "Payload", "Status")
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        on conflict ("GlobalId") do update set
          "Payload" = excluded."Payload",
          "DestinationCode" = excluded."DestinationCode",
          "Status" = excluded."Status",
          "CreatedAt" = now(),
          "SentAt" = null,
          "Attempts" = 0,
          "LastError" = null
      `,
      payload.globalId,
      payload.eventType,
      payload.devolucion.numero,
      payload.devolucion.codigoBodega,
      payload.devolucion.codigoTienda,
      destinationCode,
      JSON.stringify(payload),
      SYNC_STATUS_PENDING,
    );
  }

  private startAutoRetry() {
    if (!this.readBooleanConfig("DEVRAPIDA_SYNC_AUTO_RETRY_ENABLED", true)) {
      this.logger.log("Reintento automatico de devoluciones rapidas deshabilitado.");
      return;
    }

    const intervalMs = this.readPositiveIntegerConfig("DEVRAPIDA_SYNC_AUTO_RETRY_INTERVAL_MS", DEFAULT_AUTO_RETRY_INTERVAL_MS);
    this.autoRetryStartupTimer = setTimeout(() => {
      this.autoRetryStartupTimer = null;
      void this.runAutoRetryCycle();
    }, DEFAULT_AUTO_RETRY_STARTUP_DELAY_MS);
    this.autoRetryTimer = setInterval(() => {
      void this.runAutoRetryCycle();
    }, intervalMs);
  }

  private async runAutoRetryCycle() {
    if (this.autoRetryInProgress) {
      return;
    }

    this.autoRetryInProgress = true;
    syncHealthRegistry.recordAttempt(SYNC_HEALTH_KEY);

    try {
      const push = await this.pushPending(DEFAULT_AUTO_RETRY_LIMIT);
      const pull = await this.pullRemote({ limit: DEFAULT_AUTO_RETRY_LIMIT });
      const applied = pull.enabled ? pull.applied : await this.applyPendingConfirmations();

      if (push.processed > 0 || pull.processed > 0 || applied > 0) {
        this.logger.log(
          `Devoluciones rapidas: push=${push.processed}, pull=${pull.processed} (${pull.imported} nuevo(s)), confirmadas en bodega=${applied}.`,
        );
      }
      syncHealthRegistry.recordSuccess(SYNC_HEALTH_KEY, `push=${push.processed} pull=${pull.processed}`);
    } catch (error) {
      const message = this.extractErrorMessage(error);
      syncHealthRegistry.recordError(SYNC_HEALTH_KEY, message);
      this.logger.warn(`Fallo el ciclo de sincronizacion de devoluciones rapidas: ${message}`);
    } finally {
      this.autoRetryInProgress = false;
    }
  }

  // Misma regla que transferencias (resolveTransferSyncPullRemoteApiUrl): la URL remota del
  // .env + la ruta de este nodo. La gemela del VPS nunca descarga de si misma.
  private resolvePullRemoteApiUrl() {
    const identity = this.nodeIdentity.get();
    if (identity.conflict || identity.isVpsInstance) {
      return null;
    }

    const configured = this.normalizeApiUrl(
      this.configService.get<string>("TRANSFER_SYNC_REMOTE_API_URL") ||
        this.configService.get<string>("MIRROR_SYNC_REMOTE_API_URL"),
    );
    if (!configured) {
      return null;
    }

    try {
      const url = new URL(configured);
      if (url.pathname && url.pathname !== "/") {
        return configured;
      }
    } catch {
      return null;
    }

    return identity.remotePath === null ? null : `${configured}${identity.remotePath}`;
  }

  private async resolvePeerApiUrl(code: string) {
    const rows = await this.prisma.$queryRawUnsafe<SyncNodeRow[]>(
      `
        select "NodeId", "SucursalCodigo", "ApiUrl"
        from dbo."SYNC_NODES"
        where upper("SucursalCodigo") = upper($1) or upper("NodeId") = upper($1)
        order by case when upper("SucursalCodigo") = upper($1) then 0 else 1 end
        limit 1
      `,
      code,
    ).catch(() => [] as SyncNodeRow[]);

    const node = rows[0];
    const resolved = this.nodeIdentity.resolvePeerApiUrl(node?.NodeId ?? code, node?.ApiUrl ?? null);
    if (resolved) {
      return resolved;
    }

    // Las gemelas del VPS tienen MIRROR_SYNC_REMOTE_API_URL vacio y no siempre tienen el otro
    // nodo en SYNC_NODES; todas viven detras del mismo Nginx, asi que se llega por 127.0.0.1.
    // Solo pasa si alguien carga una devolucion directo en la gemela de la tienda.
    const descriptor = describeNode(node?.NodeId ?? code);
    if (this.nodeIdentity.get().isVpsInstance && descriptor) {
      return `http://127.0.0.1${descriptor.remotePath}`;
    }

    return null;
  }

  private async loginRemote(baseUrl: string) {
    let lastError = "Usuario o clave invalidos";
    let lastStatus = 401;

    for (const candidate of this.getRemoteCredentialCandidates()) {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(candidate),
        },
        DEVRAPIDA_SYNC_REQUEST_TIMEOUT_MS,
      );
      const body = await this.readRemoteJson(response);
      if (response.ok && this.isRecord(body) && typeof body.accessToken === "string") {
        return body.accessToken;
      }

      lastError = this.formatRemoteError(body, response.status);
      lastStatus = response.status;
    }

    throw new ConflictException(`No se pudo autenticar contra el nodo remoto: ${this.formatRemoteError(lastError, lastStatus)}`);
  }

  // Mismas cuentas tecnicas que usa la sincronizacion de transferencias.
  private getRemoteCredentialCandidates() {
    const candidates = [
      {
        usuario: this.configService.get<string>("TRANSFER_SYNC_USERNAME", "admin"),
        password: this.configService.get<string>("TRANSFER_SYNC_PASSWORD", "123456"),
      },
      {
        usuario: this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_USERNAME", "admin"),
        password: this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "123456"),
      },
      // Las gemelas del VPS no traen admin de arranque; su cuenta tecnica es "sistema".
      {
        usuario: this.configService.get<string>("MIRROR_SYNC_USERNAME", ""),
        password: this.configService.get<string>("MIRROR_SYNC_PASSWORD", ""),
      },
      {
        usuario: this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_USERNAME", ""),
        password: this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_PASSWORD", ""),
      },
      { usuario: "admin", password: "789456" },
      { usuario: "admin", password: "123456" },
    ];

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const usuario = String(candidate.usuario || "").trim();
      const password = String(candidate.password || "").trim();
      const key = `${usuario}::${password}`;
      if (!usuario || !password || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  // ---------------------------------------------------------------------------------------
  // Reglas de nodo
  // ---------------------------------------------------------------------------------------

  private canRegisterHere() {
    const identity = this.nodeIdentity.get();
    return (
      !identity.conflict &&
      !identity.isVpsInstance &&
      Boolean(identity.sucursalCodigo) &&
      (identity.role === "central" || identity.role === "bodega")
    );
  }

  // Devuelve el codigo de sucursal de esta bodega (ORIGEN, B002, B003).
  private assertCanRegisterHere() {
    const identity = this.nodeIdentity.get();
    if (identity.conflict) {
      throw new ConflictException(`Identidad del nodo en conflicto: ${identity.conflict}`);
    }

    if (identity.role !== "central" && identity.role !== "bodega") {
      throw new BadRequestException("La devolucion rapida solo se registra desde una bodega.");
    }

    if (identity.isVpsInstance) {
      throw new BadRequestException(
        "La devolucion rapida se registra en la PC de la bodega, no en su respaldo del VPS.",
      );
    }

    if (!identity.sucursalCodigo) {
      throw new BadRequestException("Esta bodega no tiene identidad de nodo (NODE_ID).");
    }

    return identity.sucursalCodigo;
  }

  private selfNodeIdOrThrow() {
    const nodeId = this.nodeIdentity.get().nodeId;
    if (!nodeId) {
      throw new BadRequestException("Esta bodega no tiene identidad de nodo (NODE_ID).");
    }

    return nodeId;
  }

  private normalizeStoreCode(value: string) {
    const descriptor = describeNode(value);
    if (!descriptor || descriptor.role !== "tienda") {
      throw new BadRequestException("Debes elegir la tienda que devuelve la mercancia.");
    }

    return descriptor.sucursalCodigo;
  }

  // Un paquete mal ruteado se rechaza en vez de aplicarse en la tienda equivocada. Los nodos
  // sin identidad estandar (pruebas) no se validan.
  private assertPayloadIsForThisStore(codigoTienda: string) {
    this.nodeIdentity.assertSyncIdentity();
    const own = this.nodeIdentity.get().sucursalCodigo;
    const target = describeNode(codigoTienda)?.sucursalCodigo ?? codigoTienda;
    if (own && own.toUpperCase() !== String(target).toUpperCase()) {
      throw new BadRequestException(`La devolucion rapida es para la tienda ${codigoTienda}, no para esta sede (${own}).`);
    }
  }

  private assertPayloadIsForThisWarehouse(codigoBodega: string) {
    this.nodeIdentity.assertSyncIdentity();
    const own = this.nodeIdentity.get().sucursalCodigo;
    const target = describeNode(codigoBodega)?.sucursalCodigo ?? codigoBodega;
    if (own && own.toUpperCase() !== String(target).toUpperCase()) {
      throw new BadRequestException(`La confirmacion es para la bodega ${codigoBodega}, no para esta sede (${own}).`);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Lectura / helpers de datos
  // ---------------------------------------------------------------------------------------

  private async normalizeLines(tx: DevRapidaTransactionClient, items: CreateDevolucionRapidaLineDto[]) {
    const meaningful = (Array.isArray(items) ? items : []).filter((item) => String(item?.codigoBarra || "").trim());
    if (meaningful.length === 0) {
      throw new BadRequestException("La devolucion rapida debe tener al menos un articulo.");
    }

    const codes = meaningful.map((item) => String(item.codigoBarra).trim().toUpperCase());
    const inventory = await this.loadInventoryByCode(tx, codes);
    const missing = Array.from(new Set(codes.filter((code) => !inventory.has(code))));
    if (missing.length > 0) {
      throw new NotFoundException(`No se encontraron articulos en inventario para: ${missing.join(", ")}.`);
    }

    return meaningful.map<NormalizedLine>((item, index) => {
      const codigoBarra = codes[index];
      const article = inventory.get(codigoBarra)!;
      const referencia = String(article.Referencia || "").trim().toUpperCase();
      const requested = String(item.referencia || "").trim().toUpperCase();
      if (requested && requested !== referencia) {
        throw new BadRequestException(
          `El articulo ${codigoBarra} no coincide con la referencia ${requested} en inventario.`,
        );
      }

      let cantidad: Prisma.Decimal;
      try {
        cantidad = new Prisma.Decimal(String(item.cantidad || "").trim());
      } catch {
        throw new BadRequestException(`La cantidad del articulo ${codigoBarra} no es valida.`);
      }
      if (cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`La cantidad del articulo ${codigoBarra} debe ser mayor a cero.`);
      }

      return {
        item: index + 1,
        codigoBarra,
        referencia,
        codigoMarca: String(article.CodigoMarca || "").trim().toUpperCase(),
        nombre: String(article.Nombre || "").trim(),
        cantidad,
        valor: this.resolveLineValue(article),
      };
    });
  }

  private async insertLines(tx: DevRapidaTransactionClient, numero: number, lines: NormalizedLine[]) {
    for (const line of lines) {
      await tx.$executeRawUnsafe(
        `
          insert into dbo."MOVDEVRAPIDA"
            ("Numero", "Item", "CodigoBarra", "Referencia", "CodigoMarca", "Nombre", "Cantidad", "Valor")
          values ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric)
        `,
        numero,
        line.item,
        line.codigoBarra,
        line.referencia,
        line.codigoMarca,
        line.nombre.slice(0, 150),
        line.cantidad.toString(),
        line.valor.toString(),
      );
    }
  }

  private computeTotal(lines: NormalizedLine[]) {
    return lines.reduce((total, line) => total.plus(line.valor.mul(line.cantidad)), ZERO);
  }

  // Mismo criterio que transfers.service.ts#resolveLineValue: el "Costo" (CostoDolar) y los
  // otros costos como respaldo.
  private resolveLineValue(article: Inventario) {
    for (const value of [article.CostoDolar, article.UltimoCosto, article.CostoPromedio, article.CostoInicial]) {
      if (value && !value.isZero()) {
        return value;
      }
    }

    return ZERO;
  }

  private sameIdentity(article: Inventario, line: RegisteredLinePayload) {
    const normalize = (value: unknown) => String(value ?? "").trim().toUpperCase();
    return (
      normalize(article.Referencia) === normalize(line.referencia) &&
      normalize(article.CodigoMarca) === normalize(line.codigoMarca)
    );
  }

  private async getNextNumber(tx: DevRapidaTransactionClient) {
    const rows = await tx.$queryRawUnsafe<Array<{ next: number }>>(
      `select (coalesce(max("Numero"), 0) + 1)::int as next from dbo."DEVRAPIDA"`,
    );
    return rows[0]?.next ?? 1;
  }

  private async loadInventoryByCode(client: DbClient, codes: string[]) {
    const unique = Array.from(new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)));
    if (unique.length === 0) {
      return new Map<string, Inventario>();
    }

    const items = await client.inventario.findMany({ where: { CodigoBarra: { in: unique } } });
    return new Map(items.map((item) => [item.CodigoBarra.trim().toUpperCase(), item]));
  }

  private async findHeader(client: DbClient, numero: number) {
    const rows = await client.$queryRawUnsafe<DevRapidaRow[]>(
      `select * from dbo."DEVRAPIDA" where "Numero" = $1`,
      numero,
    );
    return rows[0] ?? null;
  }

  private async findHeaderOrThrow(client: DbClient, numero: number) {
    const header = await this.findHeader(client, numero);
    if (!header) {
      throw new NotFoundException("La devolucion rapida no existe.");
    }

    return header;
  }

  private async getLines(client: DbClient, numero: number) {
    return client.$queryRawUnsafe<DevRapidaLineRow[]>(
      `select * from dbo."MOVDEVRAPIDA" where "Numero" = $1 order by "Item" asc`,
      numero,
    );
  }

  private async findDetailOrThrow(client: DbClient, numero: number) {
    const header = await this.findHeaderOrThrow(client, numero);
    const [lines, names, syncRows] = await Promise.all([
      this.getLines(client, numero),
      this.loadSucursalNames([header.CodigoBodega, header.CodigoTienda], client),
      this.loadRegisteredOutboxRows([numero], client),
    ]);
    const inventory = await this.loadInventoryByCode(client, lines.map((line) => line.CodigoBarra));

    return {
      ...this.toHeaderView(header, names, syncRows.get(numero) ?? null),
      items: lines.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        referencia: line.Referencia,
        codigoMarca: line.CodigoMarca,
        nombre: line.Nombre,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
        existenciaBodega: inventory.get(line.CodigoBarra.trim().toUpperCase())?.Existencia.toString() ?? null,
      })),
    };
  }

  private async findInboundDetailOrThrow(client: DbClient, globalId: string) {
    const row = await this.getInboxRow(client, globalId);
    if (!row || row.EventType !== DEVRAPIDA_EVENT_REGISTERED) {
      throw new NotFoundException("La devolucion rapida recibida no existe en esta tienda.");
    }

    const names = await this.loadSucursalNames([row.CodigoBodega, row.CodigoTienda], client);
    const view = this.toInboundView(row, names);
    if (!view) {
      throw new ConflictException("El paquete de la devolucion rapida esta danado.");
    }

    const payload = this.parseRegisteredPayload(this.parseRawJson(row.Payload));
    const inventory = await this.loadInventoryByCode(client, payload.items.map((line) => line.codigoBarra));

    return {
      ...view,
      items: payload.items.map((line) => {
        const article = inventory.get(line.codigoBarra.trim().toUpperCase());
        return {
          item: line.item,
          codigoBarra: line.codigoBarra,
          referencia: line.referencia,
          codigoMarca: line.codigoMarca,
          nombre: line.nombre,
          cantidad: line.cantidad,
          existenciaTienda: article ? article.Existencia.toString() : null,
          existeEnTienda: Boolean(article),
          identidadCoincide: article ? this.sameIdentity(article, line) : false,
        };
      }),
    };
  }

  private async getInboxRow(client: DbClient, globalId: string) {
    const rows = await client.$queryRawUnsafe<InboxRow[]>(
      `select * from dbo."DEVRAPIDA_SYNC_INBOX" where "GlobalId" = $1 limit 1`,
      globalId,
    );
    return rows[0] ?? null;
  }

  private async loadRegisteredOutboxRows(numeros: number[], client: DbClient = this.prisma) {
    if (numeros.length === 0) {
      return new Map<number, OutboxRow>();
    }

    const rows = await client.$queryRawUnsafe<OutboxRow[]>(
      `
        select *
        from dbo."DEVRAPIDA_SYNC_OUTBOX"
        where "EventType" = $1 and "NumeroOrigen" = any($2::int[])
      `,
      DEVRAPIDA_EVENT_REGISTERED,
      numeros,
    );
    return new Map(rows.map((row) => [row.NumeroOrigen, row]));
  }

  private async loadSucursalNames(codes: string[], client: DbClient = this.prisma) {
    const unique = Array.from(new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)));
    if (unique.length === 0) {
      return new Map<string, string>();
    }

    const rows = await client.sucursales.findMany({ where: { Codigo: { in: unique } } });
    return new Map(rows.map((row) => [row.Codigo.trim().toUpperCase(), row.Nombre]));
  }

  private toHeaderView(row: DevRapidaRow, names: Map<string, string>, sync: OutboxRow | null) {
    return {
      numero: row.Numero,
      fecha: row.Fecha,
      codigoBodega: row.CodigoBodega,
      nombreBodega: names.get(row.CodigoBodega.toUpperCase()) ?? row.CodigoBodega,
      codigoTienda: row.CodigoTienda,
      nombreTienda: names.get(row.CodigoTienda.toUpperCase()) ?? row.CodigoTienda,
      observacion: row.Observacion,
      totalValor: row.TotalValor.toString(),
      status: row.Status,
      usuario: row.Usuario,
      fechaAprobacion: row.FechaAprobacion,
      fechaConfirmacion: row.FechaConfirmacion,
      usuarioConfirma: row.UsuarioConfirma,
      syncStatus: sync?.Status ?? null,
      syncError: sync?.LastError ?? null,
      syncEnviado: sync?.SentAt ?? null,
    };
  }

  private toInboundView(row: InboxRow, names: Map<string, string>) {
    let payload: RegisteredPayload;
    try {
      payload = this.parseRegisteredPayload(this.parseRawJson(row.Payload));
    } catch {
      return null;
    }

    const cantidadTotal = payload.items.reduce((total, line) => total.plus(new Prisma.Decimal(line.cantidad)), ZERO);
    return {
      globalId: row.GlobalId,
      numero: row.NumeroOrigen,
      fecha: payload.devolucion.fecha,
      fechaAprobacion: payload.devolucion.fechaAprobacion,
      codigoBodega: row.CodigoBodega,
      nombreBodega: names.get(row.CodigoBodega.toUpperCase()) ?? row.CodigoBodega,
      codigoTienda: row.CodigoTienda,
      nombreTienda: names.get(row.CodigoTienda.toUpperCase()) ?? row.CodigoTienda,
      observacion: payload.devolucion.observacion,
      usuario: payload.devolucion.usuario,
      lineas: payload.items.length,
      cantidadTotal: cantidadTotal.toString(),
      cargada: row.Status === SYNC_STATUS_APPLIED,
      fechaCarga: row.AppliedAt,
      usuarioCarga: row.AppliedBy,
      recibido: row.ReceivedAt,
      ultimoError: row.LastError,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Payloads
  // ---------------------------------------------------------------------------------------

  private parseSyncPayload(body: unknown): SyncPayload {
    if (!this.isRecord(body)) {
      throw new BadRequestException("Paquete de devolucion rapida invalido.");
    }

    if (body.eventType === DEVRAPIDA_EVENT_REGISTERED) {
      return this.parseRegisteredPayload(body);
    }

    if (body.eventType === DEVRAPIDA_EVENT_CONFIRMED) {
      return this.parseConfirmedPayload(body);
    }

    throw new BadRequestException("Tipo de paquete de devolucion rapida desconocido.");
  }

  private parseRegisteredPayload(body: unknown): RegisteredPayload {
    if (!this.isRecord(body) || body.eventType !== DEVRAPIDA_EVENT_REGISTERED || !this.isRecord(body.devolucion)) {
      throw new BadRequestException("Paquete de devolucion rapida invalido.");
    }

    const devolucion = body.devolucion;
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      throw new BadRequestException("El paquete de devolucion rapida no trae articulos.");
    }

    return {
      schemaVersion: Number(body.schemaVersion) || DEVRAPIDA_SYNC_SCHEMA_VERSION,
      eventType: DEVRAPIDA_EVENT_REGISTERED,
      globalId: this.normalizeGlobalId(body.globalId),
      sourceNodeId: this.requiredText(body.sourceNodeId, "sourceNodeId"),
      destinationNodeId: this.requiredText(body.destinationNodeId, "destinationNodeId"),
      devolucion: {
        numero: this.positiveInteger(devolucion.numero, "numero"),
        fecha: this.requiredText(devolucion.fecha, "fecha"),
        fechaAprobacion: this.requiredText(devolucion.fechaAprobacion, "fechaAprobacion"),
        codigoBodega: this.requiredText(devolucion.codigoBodega, "codigoBodega").toUpperCase(),
        codigoTienda: this.requiredText(devolucion.codigoTienda, "codigoTienda").toUpperCase(),
        observacion: String(devolucion.observacion ?? ""),
        totalValor: this.decimalText(devolucion.totalValor ?? "0", "totalValor"),
        usuario: String(devolucion.usuario ?? ""),
      },
      items: items.map((raw, index) => {
        if (!this.isRecord(raw)) {
          throw new BadRequestException(`Renglon ${index + 1} invalido en la devolucion rapida.`);
        }

        const cantidad = this.decimalText(raw.cantidad, `cantidad del renglon ${index + 1}`);
        if (new Prisma.Decimal(cantidad).lessThanOrEqualTo(0)) {
          throw new BadRequestException(`La cantidad del renglon ${index + 1} debe ser mayor a cero.`);
        }

        return {
          item: this.positiveInteger(raw.item ?? index + 1, "item"),
          codigoBarra: this.requiredText(raw.codigoBarra, "codigoBarra").toUpperCase(),
          referencia: String(raw.referencia ?? "").trim().toUpperCase(),
          codigoMarca: String(raw.codigoMarca ?? "").trim().toUpperCase(),
          nombre: String(raw.nombre ?? ""),
          cantidad,
          valor: this.decimalText(raw.valor ?? "0", "valor"),
        };
      }),
    };
  }

  private parseConfirmedPayload(body: unknown): ConfirmedPayload {
    if (!this.isRecord(body) || body.eventType !== DEVRAPIDA_EVENT_CONFIRMED || !this.isRecord(body.devolucion)) {
      throw new BadRequestException("Confirmacion de devolucion rapida invalida.");
    }

    const devolucion = body.devolucion;
    const items = Array.isArray(body.items) ? body.items : [];

    return {
      schemaVersion: Number(body.schemaVersion) || DEVRAPIDA_SYNC_SCHEMA_VERSION,
      eventType: DEVRAPIDA_EVENT_CONFIRMED,
      globalId: this.normalizeGlobalId(body.globalId),
      registeredGlobalId: this.normalizeGlobalId(body.registeredGlobalId),
      sourceNodeId: this.requiredText(body.sourceNodeId, "sourceNodeId"),
      destinationNodeId: this.requiredText(body.destinationNodeId, "destinationNodeId"),
      devolucion: {
        numero: this.positiveInteger(devolucion.numero, "numero"),
        codigoBodega: this.requiredText(devolucion.codigoBodega, "codigoBodega").toUpperCase(),
        codigoTienda: this.requiredText(devolucion.codigoTienda, "codigoTienda").toUpperCase(),
        fechaCarga: this.requiredText(devolucion.fechaCarga, "fechaCarga"),
        usuarioCarga: String(devolucion.usuarioCarga ?? ""),
      },
      items: items.filter((raw) => this.isRecord(raw)).map((raw, index) => {
        const line = raw as Record<string, unknown>;
        return {
          item: this.positiveInteger(line.item ?? index + 1, "item"),
          codigoBarra: this.requiredText(line.codigoBarra, "codigoBarra").toUpperCase(),
          cantidad: this.decimalText(line.cantidad, "cantidad"),
        };
      }),
    };
  }

  private buildRegisteredGlobalId(sourceNodeId: string, numero: number) {
    return `${sourceNodeId.trim().toUpperCase()}-DVR-${String(numero).padStart(10, "0")}`;
  }

  private buildConfirmedGlobalId(registeredGlobalId: string) {
    return `${registeredGlobalId}-CONF`;
  }

  private normalizeGlobalId(value: unknown) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,80}$/.test(normalized)) {
      throw new BadRequestException("Identificador de devolucion rapida invalido.");
    }

    return normalized;
  }

  private requiredText(value: unknown, field: string) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      throw new BadRequestException(`Falta ${field} en el paquete de devolucion rapida.`);
    }

    return normalized;
  }

  private positiveInteger(value: unknown, field: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${field} invalido en el paquete de devolucion rapida.`);
    }

    return parsed;
  }

  private decimalText(value: unknown, field: string) {
    try {
      return new Prisma.Decimal(String(value ?? "").trim()).toString();
    } catch {
      throw new BadRequestException(`${field} invalido en el paquete de devolucion rapida.`);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Esquema
  // ---------------------------------------------------------------------------------------

  private async ensureSchema(client: DbClient = this.prisma) {
    await client.$executeRawUnsafe(`
      create table if not exists dbo."DEVRAPIDA" (
        "Numero" integer primary key,
        "Fecha" timestamptz not null default now(),
        "CodigoBodega" varchar(15) not null,
        "CodigoTienda" varchar(15) not null,
        "Observacion" varchar(100) not null default '',
        "TotalValor" numeric(24,8) not null default 0,
        "Status" integer not null default 0,
        "Usuario" varchar(15) not null,
        "FechaAprobacion" timestamptz,
        "FechaConfirmacion" timestamptz,
        "UsuarioConfirma" varchar(15)
      )
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."MOVDEVRAPIDA" (
        "Numero" integer not null references dbo."DEVRAPIDA" ("Numero") on delete cascade,
        "Item" integer not null,
        "CodigoBarra" varchar(30) not null,
        "Referencia" varchar(30) not null,
        "CodigoMarca" varchar(10) not null,
        "Nombre" varchar(150) not null,
        "Cantidad" numeric(18,2) not null,
        "Valor" numeric(24,8) not null default 0,
        primary key ("Numero", "Item")
      )
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."DEVRAPIDA_SYNC_OUTBOX" (
        "GlobalId" text primary key,
        "EventType" varchar(40) not null,
        "NumeroOrigen" integer not null,
        "CodigoBodega" varchar(15) not null,
        "CodigoTienda" varchar(15) not null,
        "DestinationCode" varchar(15) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null default 'PENDING',
        "CreatedAt" timestamptz not null default now(),
        "SentAt" timestamptz,
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_DEVRAPIDA_SYNC_OUTBOX_Status"
      on dbo."DEVRAPIDA_SYNC_OUTBOX" ("Status", "CreatedAt")
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."DEVRAPIDA_SYNC_INBOX" (
        "GlobalId" text primary key,
        "EventType" varchar(40) not null,
        "NumeroOrigen" integer not null,
        "CodigoBodega" varchar(15) not null,
        "CodigoTienda" varchar(15) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null default 'RECEIVED',
        "ReceivedAt" timestamptz not null default now(),
        "AppliedAt" timestamptz,
        "AppliedBy" varchar(15),
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_DEVRAPIDA_SYNC_INBOX_Status"
      on dbo."DEVRAPIDA_SYNC_INBOX" ("EventType", "Status", "ReceivedAt")
    `);
  }

  // ---------------------------------------------------------------------------------------
  // Utilitarios
  // ---------------------------------------------------------------------------------------

  private normalizeUsuario(user: UserView | null) {
    return String(user?.codUsuario || "").trim().toUpperCase().slice(0, 15) || "SISTEMA";
  }

  private getMaxAttempts() {
    return this.readPositiveIntegerConfig("DEVRAPIDA_SYNC_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS);
  }

  private normalizeApiUrl(value: unknown) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(normalized) ? normalized : null;
  }

  private parseRawJson(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private async readRemoteJson(response: Response) {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private formatRemoteError(body: unknown, status: number) {
    if (this.isRecord(body)) {
      if (Array.isArray(body.message)) {
        return body.message.join("; ");
      }
      if (typeof body.message === "string") {
        return body.message;
      }
      if (typeof body.error === "string") {
        return body.error;
      }
    }

    return typeof body === "string" && body ? body : `HTTP ${status}`;
  }

  private extractErrorMessage(error: unknown) {
    if (error instanceof Error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      if (this.isRecord(response) && typeof response.message === "string") {
        return response.message;
      }
      return error.message.trim();
    }

    return String(error);
  }

  private readBooleanConfig(name: string, fallback: boolean) {
    const raw = this.configService.get<string | boolean | undefined>(name);
    if (raw === undefined || raw === null || raw === "") {
      return fallback;
    }

    if (typeof raw === "boolean") {
      return raw;
    }

    const normalized = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "si", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  private readPositiveIntegerConfig(name: string, fallback: number) {
    const parsed = Number(this.configService.get<string | number | undefined>(name));
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}

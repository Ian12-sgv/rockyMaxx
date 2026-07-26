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
import { Prisma, type Inventario, type Sucursales } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { UserView } from "../users/user-view.util";
import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { ApproveTransferDto, TransferDuplicateResolutionDto } from "./dto/approve-transfer.dto";
import { CreateTransferDto, CreateTransferLineDto } from "./dto/create-transfer.dto";
import { FindTransfersDto } from "./dto/find-transfers.dto";
import { FindTransferSyncOutboxDto, PushTransferSyncDto, RegisterTransferSyncNodeDto } from "./dto/transfer-sync.dto";
import { UpdateTransferDto } from "./dto/update-transfer.dto";
import { toTransferDetailView, toTransferListItemView, transferInclude } from "./transfer-view.util";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_TRANSFER_LOT = "TR_AUTO";
const DEFAULT_TRANSFER_LOT_DESCRIPTION = "Lote automatico para transferencias";
const DEFAULT_DISPATCH_ID = 0;
const DUPLICATE_BARCODE_MESSAGE = "Codigo de barra duplicado.";
const DEFAULT_ORIGIN_CODE = "ORIGEN";
const DEFAULT_DESTINATION_CODE = "DESTINO";
const TRANSFER_SYNC_SCHEMA_VERSION = 1;
const TRANSFER_SYNC_EVENT_APPROVED = "TRANSFER_APPROVED";
const TRANSFER_SYNC_STATUS_PENDING = "PENDING";
const TRANSFER_SYNC_STATUS_SENT = "SENT";
const TRANSFER_SYNC_STATUS_RECEIVED = "RECEIVED";
const TRANSFER_SYNC_STATUS_APPLIED = "APPLIED";
const TRANSFER_SYNC_STATUS_ERROR = "ERROR";
const DEFAULT_TRANSFER_SYNC_AUTO_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_TRANSFER_SYNC_AUTO_RETRY_STARTUP_DELAY_MS = 5_000;
const DEFAULT_TRANSFER_SYNC_AUTO_RETRY_LIMIT = 25;
const INVENTORY_BULK_STATUS_PENDING = "PENDING";
const INVENTORY_BULK_STATUS_RUNNING = "RUNNING";
const INVENTORY_BULK_STATUS_COMPLETED = "COMPLETED";
const INVENTORY_BULK_STATUS_ERROR = "ERROR";
const INVENTORY_BULK_BATCH_SIZE = 25;
const INVENTORY_BULK_RETRY_INTERVAL_MS = 30_000;
const ZERO = new Prisma.Decimal(0);

type TransferTransactionClient = Prisma.TransactionClient;
type TransferDuplicateResolutionAction = "modify-existing" | "create-new";
type TransferDuplicateResolution = {
  action: TransferDuplicateResolutionAction;
  nuevoCodigoBarra?: string;
};

type NormalizedTransferLine = {
  item: number;
  fecha: Date;
  codigoBarra: string;
  referencia: string;
  cantidad: Prisma.Decimal;
  valor: Prisma.Decimal;
  numeroCaja: number;
  ultimoCosto: Prisma.Decimal | null;
  costoInicial: Prisma.Decimal | null;
  costoDolar: Prisma.Decimal | null;
  articulo: Inventario;
};

type NormalizedTransferDraft = {
  fecha: Date;
  fechaEmision: Date;
  codigoEnvia: string;
  codigoRecibe: string;
  documentoOrigen: string;
  observacion: string;
  interContable: number;
  idDespacho: number;
  correccion: boolean;
  zona: string;
  lines: NormalizedTransferLine[];
  totalValor: Prisma.Decimal;
  quantitiesByBarcode: Map<string, Prisma.Decimal>;
};

type TransferSyncCatalogPayload = {
  codigo: string | number;
  nombre?: string | null;
  status?: number | null;
  porcentajeImpuesto?: string | null;
};

type TransferSyncInventoryPayload = {
  codigoBarra: string;
  referencia: string;
  codigoMarca: string;
  nombre: string;
  talla: string;
  codigoColor: string;
  fabricante: string;
  categoria: string;
  nota: string | null;
  tipoImpuesto: number;
  precioDetal: string;
  precioMayor: string;
  precioAfiliado: string;
  precioPromocion: string;
  promocion: boolean;
  fechaInicial: string;
  fechaFinal: string;
  costoInicial: string;
  costoPromedio: string;
  ultimoCosto: string;
  costoDolar: string;
  existenciaInicial: string;
  puntoReorden: string;
  tipo: number;
  status: number;
  serializado: number;
  codigoBarraAnt: string;
  catalogs: {
    marca: TransferSyncCatalogPayload;
    talla: TransferSyncCatalogPayload;
    color: TransferSyncCatalogPayload;
    fabricante: TransferSyncCatalogPayload;
    categoria: TransferSyncCatalogPayload;
    impuesto: TransferSyncCatalogPayload;
  };
};

type TransferSyncLinePayload = {
  item: number;
  fecha: string | null;
  codigoBarra: string;
  cantidad: string;
  valor: string;
  numeroCaja: number;
  ultimoCosto: string | null;
  costoInicial: string | null;
  costoDolar: string | null;
  articulo: TransferSyncInventoryPayload;
};

type TransferSyncPayload = {
  schemaVersion: number;
  eventType: typeof TRANSFER_SYNC_EVENT_APPROVED;
  globalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  transfer: {
    numero: number;
    fecha: string;
    fechaEmision: string;
    codigoEnvia: string;
    codigoRecibe: string;
    documentoOrigen: string;
    totalValor: string;
    observacion: string;
    status: number;
    usuario: string | null;
    interContable: number | null;
    idLote: number;
    lote: {
      id: number;
      lote: string;
      descripcion: string | null;
      estado: number | null;
    };
    idDespacho: number;
    tipoDespacho: {
      id: number;
      descripcion: string;
      estado: number | null;
    };
    correccion: boolean;
    zona: string;
  };
  items: TransferSyncLinePayload[];
};

type TransferForSync = Prisma.TransferenciasGetPayload<{
  include: {
    lote: true;
    tipoDespacho: true;
    sucursalRecibe: true;
    movTransferencias: {
      orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }];
      include: {
        inventarioRef: {
          include: {
            marcaRef: true;
            tallaRef: true;
            colorRef: true;
            fabricanteRef: true;
            categoriaRef: true;
            impuestoRef: true;
          };
        };
      };
    };
  };
}>;

type TransferSyncNodeRow = {
  NodeId: string;
  SucursalCodigo: string;
  Nombre: string | null;
  Tipo: string | null;
  ApiUrl: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  LastSeenAt: Date | null;
};

type TransferSyncOutboxRow = {
  GlobalId: string;
  Numero: number;
  CodigoEnvia: string;
  CodigoRecibe: string;
  SourceNodeId: string;
  DestinationNodeId: string;
  EventType: string;
  Payload: unknown;
  Status: string;
  CreatedAt: Date;
  SentAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type TransferSyncInboxRow = {
  GlobalId: string;
  NumeroOrigen: number;
  CodigoEnvia: string;
  CodigoRecibe: string;
  SourceNodeId: string;
  DestinationNodeId: string;
  EventType: string;
  Payload: unknown;
  Status: string;
  ReceivedAt: Date;
  AppliedAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type InventoryBulkJobRow = {
  JobId: string;
  DestinationNodeId: string;
  DestinationCode: string;
  DestinationName: string | null;
  ApiUrl: string;
  Status: string;
  TotalItems: number;
  ProcessedItems: number;
  CursorCodigoBarra: string | null;
  RequestedBy: string;
  CreatedAt: Date;
  UpdatedAt: Date;
  CompletedAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type TransferCorrectionItemRow = {
  Numero: number;
  Item: number;
  NumeroCaja: number;
  CodigoBarra: string;
  Referencia: string;
  CreatedAt: Date;
  UpdatedAt: Date;
};

type InboundTransferWithRelations = Prisma.ITransferenciasGetPayload<{
  include: {
    sucursalEnvia: true;
    tipoDespacho: true;
    iMovTransferencias: {
      orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }];
      include: {
        inventarioRef: {
          select: {
            CodigoBarra: true;
            Nombre: true;
            Referencia: true;
            Existencia: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class TransfersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransfersService.name);
  private transferSyncAutoRetryTimer: ReturnType<typeof setInterval> | null = null;
  private transferSyncAutoRetryStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private transferSyncAutoRetryInProgress = false;
  private inventoryBulkRetryTimer: ReturnType<typeof setInterval> | null = null;
  private inventoryBulkProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async onModuleInit() {
    await this.ensureInventoryBulkSchema();
    this.startTransferSyncAutoRetry();
    this.startInventoryBulkRetry();
  }

  onModuleDestroy() {
    this.stopTransferSyncAutoRetry();
    this.stopInventoryBulkRetry();
  }

  async getMetadata() {
    await this.ensureTransferSyncSchema();

    const [sucursales, tiposDespacho] = await Promise.all([
      this.prisma.sucursales.findMany({
        orderBy: [{ Status: "desc" }, { Codigo: "asc" }],
      }),
      this.prisma.tipoDespacho.findMany({
        orderBy: { ID: "asc" },
      }),
    ]);

    return {
      defaults: {
        fecha: new Date(),
        idDespacho: tiposDespacho.some((item) => item.ID === DEFAULT_DISPATCH_ID)
          ? DEFAULT_DISPATCH_ID
          : tiposDespacho[0]?.ID ?? null,
        status: 0,
      },
      sucursales: sucursales.map((item) => ({
        codigo: item.Codigo,
        nombre: item.Nombre,
        status: item.Status,
      })),
      tiposDespacho: tiposDespacho.map((item) => ({
        id: item.ID,
        descripcion: item.Descripcion,
        estado: item.Estado,
      })),
    };
  }

  async searchTransfers(findTransfersDto: FindTransfersDto) {
    const limit = findTransfersDto.limit ?? 25;
    const where = this.buildSearchWhere(findTransfersDto);

    const transfers = await this.prisma.transferencias.findMany({
      where,
      include: transferInclude,
      orderBy: [{ Numero: "desc" }],
      take: limit,
    });

    const originLocations = await this.loadLocationsByCode(transfers.map((item) => item.CodigoEnvia));

    return {
      items: transfers.map((item) =>
        toTransferListItemView(item, {
          codigoEnviaInfo: this.toLocationView(originLocations.get(item.CodigoEnvia)),
        }),
      ),
    };
  }

  async findOne(numero: number) {
    return {
      transferencia: await this.findTransferDetailOrThrow(this.prisma, numero),
    };
  }

  async searchInboundTransfers(findTransfersDto: FindTransfersDto) {
    await this.ensureTransferSyncSchema();
    const limit = findTransfersDto.limit ?? 25;
    await this.refreshInboundTransfersFromRemote(limit);
    const where = this.buildInboundSearchWhere(findTransfersDto);

    const transfers = await this.prisma.iTransferencias.findMany({
      where,
      include: {
        sucursalEnvia: true,
        tipoDespacho: true,
        iMovTransferencias: {
          orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
          include: {
            inventarioRef: {
              select: {
                CodigoBarra: true,
                Nombre: true,
                Referencia: true,
                Existencia: true,
              },
            },
          },
        },
      },
      orderBy: [{ Numero: "desc" }, { CodigoEnvia: "asc" }],
      take: limit,
    });
    const destinationLocations = await this.loadLocationsByCode(transfers.map((item) => item.CodigoRecibe));
    const syncRows = await this.loadInboundSyncRows(transfers);

    return {
      items: transfers.map((item) =>
        this.toInboundTransferListItemView(item, {
          codigoRecibeInfo: this.toLocationView(destinationLocations.get(item.CodigoRecibe)),
          syncRow: syncRows.get(this.buildInboundSyncKey(item.Numero, item.CodigoEnvia, item.CodigoRecibe)),
        }),
      ),
    };
  }

  private async refreshInboundTransfersFromRemote(limit: number) {
    try {
      await this.pullRemoteTransferSync({ limit });
    } catch (error) {
      this.logger.warn(
        `No se pudo refrescar el inbox remoto de transferencias antes de la consulta: ${this.extractSyncErrorMessage(error)}`,
      );
    }
  }

  async findInboundOne(numero: number) {
    return {
      transferencia: await this.findInboundTransferDetailOrThrow(numero),
    };
  }

  async loadInboundTransfer(numero: number) {
    await this.ensureTransferSyncSchema();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const transferencia = await tx.iTransferencias.findFirst({
          where: { Numero: numero },
        });

        if (!transferencia) {
          throw new NotFoundException("La transferencia recibida no existe.");
        }

        const inbox = await this.getTransferSyncInboxRowForTransfer(
          tx,
          transferencia.Numero,
          transferencia.CodigoEnvia,
          transferencia.CodigoRecibe,
        );

        if (!inbox) {
          return {
            loaded: false,
            alreadyLoaded: true,
            transferencia: await this.findInboundTransferDetailOrThrow(numero, tx),
            message: "La transferencia no tiene paquete de sincronizacion pendiente; se toma como ya cargada.",
          };
        }

        if (inbox.Status === TRANSFER_SYNC_STATUS_APPLIED) {
          return {
            loaded: false,
            alreadyLoaded: true,
            transferencia: await this.findInboundTransferDetailOrThrow(numero, tx),
            message: "La transferencia ya estaba cargada en inventario.",
          };
        }

        const payload = this.normalizeTransferSyncPayload(this.parseRawJson(inbox.Payload) as Record<string, unknown>);
        await this.ensureLocations(tx, [payload.transfer.codigoEnvia, payload.transfer.codigoRecibe]);
        await this.ensureSyncedDispatchType(tx, payload);
        await this.ensureSyncedLot(tx, payload);
        await this.applySyncedDestinationReceipt(tx, payload);
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(
          tx,
          payload.items.map((item) => item.codigoBarra),
        );
        await this.markTransferSyncInboxApplied(tx, payload.globalId);

        return {
          loaded: true,
          alreadyLoaded: false,
          transferencia: await this.findInboundTransferDetailOrThrow(numero, tx),
          message: "Transferencia cargada en inventario.",
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

    return result;
  }

  async listTransferSyncNodes() {
    await this.ensureTransferSyncSchema();
    const nodes = await this.prisma.$queryRawUnsafe<TransferSyncNodeRow[]>(`
      select
        "NodeId",
        "SucursalCodigo",
        "Nombre",
        "Tipo",
        "ApiUrl",
        "CreatedAt",
        "UpdatedAt",
        "LastSeenAt"
      from dbo."SYNC_NODES"
      order by "SucursalCodigo" asc, "NodeId" asc
    `);

    return {
      nodes: nodes.map((node) => this.toTransferSyncNodeView(node)),
    };
  }

  async registerTransferSyncNode(registerTransferSyncNodeDto: RegisterTransferSyncNodeDto) {
    await this.ensureTransferSyncSchema();
    const nodeId = this.normalizeSyncNodeId(registerTransferSyncNodeDto.nodeId);
    const sucursalCodigo = this.normalizeRequiredCode(
      registerTransferSyncNodeDto.sucursalCodigo,
      "Debes indicar la sucursal del nodo.",
    );
    const nombre = String(registerTransferSyncNodeDto.nombre || sucursalCodigo).trim();
    const tipo = String(registerTransferSyncNodeDto.tipo || "SUCURSAL").trim().toUpperCase();
    const apiUrl = this.normalizeOptionalApiUrl(registerTransferSyncNodeDto.apiUrl);

    await this.ensureLocations(this.prisma, [sucursalCodigo]);
    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."SYNC_NODES"
          ("NodeId", "SucursalCodigo", "Nombre", "Tipo", "ApiUrl", "CreatedAt", "UpdatedAt", "LastSeenAt")
        values ($1, $2, $3, $4, $5, now(), now(), now())
        on conflict ("NodeId") do update set
          "SucursalCodigo" = excluded."SucursalCodigo",
          "Nombre" = excluded."Nombre",
          "Tipo" = excluded."Tipo",
          "ApiUrl" = excluded."ApiUrl",
          "UpdatedAt" = now(),
          "LastSeenAt" = now()
      `,
      nodeId,
      sucursalCodigo,
      nombre,
      tipo,
      apiUrl,
    );

    return {
      node: await this.getTransferSyncNodeById(nodeId),
    };
  }

  async listTransferSyncOutbox(findTransferSyncOutboxDto: FindTransferSyncOutboxDto) {
    await this.ensureTransferSyncSchema();
    const status = findTransferSyncOutboxDto.status
      ? String(findTransferSyncOutboxDto.status).trim().toUpperCase()
      : TRANSFER_SYNC_STATUS_PENDING;
    const limit = findTransferSyncOutboxDto.limit ?? 50;

    const rows = await this.prisma.$queryRawUnsafe<TransferSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "Numero",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_OUTBOX"
        where "Status" = $1
        order by "CreatedAt" asc
        limit $2
      `,
      status,
      limit,
    );

    return {
      items: rows.map((row) => this.toTransferSyncOutboxView(row)),
    };
  }

  async pushPendingTransferSync(pushTransferSyncDto: PushTransferSyncDto = {}) {
    await this.ensureTransferSyncSchema();
    const limit = pushTransferSyncDto.limit ?? 50;
    const rows = await this.getTransferSyncOutboxRows(TRANSFER_SYNC_STATUS_PENDING, limit);
    const results = await this.pushTransferSyncRows(rows);

    return {
      processed: results.length,
      results,
    };
  }

  async exportTransferSyncInbox(pushTransferSyncDto: PushTransferSyncDto = {}) {
    await this.ensureTransferSyncSchema();
    const limit = pushTransferSyncDto.limit ?? 50;
    const rows = await this.getTransferSyncInboxRowsForExport(limit);

    return {
      processed: rows.length,
      items: rows
        .map((row) => {
          const payload = this.tryNormalizeTransferSyncPayloadFromRaw(row.Payload);
          if (!payload) {
            return null;
          }

          return {
            globalId: row.GlobalId,
            numeroOrigen: row.NumeroOrigen,
            codigoEnvia: row.CodigoEnvia,
            codigoRecibe: row.CodigoRecibe,
            status: row.Status,
            recibido: row.ReceivedAt,
            aplicado: row.AppliedAt,
            payload,
          };
        })
        .filter(Boolean),
    };
  }

  async pullRemoteTransferSync(pushTransferSyncDto: PushTransferSyncDto = {}) {
    await this.ensureTransferSyncSchema();

    const remoteApiUrl = await this.resolveTransferSyncPullRemoteApiUrl();
    if (!remoteApiUrl) {
      return {
        enabled: false,
        processed: 0,
        imported: 0,
        applied: 0,
        results: [],
        message: "Esta sede local no tiene una ruta remota de transferencias configurada para descarga automatica.",
      };
    }

    const limit = pushTransferSyncDto.limit ?? 50;
    const token = await this.loginRemoteSyncNode(remoteApiUrl);
    const response = await fetch(`${remoteApiUrl}/api/transfers/sync/inbox/export?limit=${limit}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });
    const responseBody = await this.readRemoteJson(response);

    if (!response.ok || !this.isRecord(responseBody) || !Array.isArray(responseBody.items)) {
      throw new ConflictException(
        `No se pudo descargar el inbox remoto de transferencias: ${this.formatRemoteError(responseBody, response.status)}`,
      );
    }

    const results: Array<Record<string, unknown>> = [];
    let imported = 0;
    let applied = 0;

    for (const rawItem of responseBody.items) {
      if (!this.isRecord(rawItem) || !this.isRecord(rawItem.payload)) {
        continue;
      }

      const remoteStatus = String(rawItem.status || "").trim().toUpperCase();
      const importResult = await this.importTransferSyncPackage(rawItem.payload);
      if (importResult.imported) {
        imported += 1;
      }

      let loadResult: Record<string, unknown> | null = null;
      if (remoteStatus === TRANSFER_SYNC_STATUS_APPLIED) {
        const payload = this.tryNormalizeTransferSyncPayloadFromRaw(rawItem.payload);
        if (payload) {
          const inboundDetail = await this.findInboundTransferDetailOrThrow(payload.transfer.numero);
          const localAlreadyApplied = inboundDetail.syncStatus === TRANSFER_SYNC_STATUS_APPLIED;
          if (!localAlreadyApplied) {
            const localLoad = await this.loadInboundTransfer(payload.transfer.numero);
            if (localLoad.loaded || localLoad.alreadyLoaded) {
              applied += 1;
            }

            loadResult = {
              loaded: localLoad.loaded,
              alreadyLoaded: localLoad.alreadyLoaded,
              message: localLoad.message ?? null,
            };
          } else {
            loadResult = {
              loaded: false,
              alreadyLoaded: true,
              message: "La transferencia ya estaba aplicada localmente.",
            };
          }
        }
      }

      results.push({
        globalId: typeof rawItem.globalId === "string" ? rawItem.globalId : importResult.globalId,
        status: remoteStatus || TRANSFER_SYNC_STATUS_RECEIVED,
        imported: importResult.imported,
        localStatus: importResult.status,
        load: loadResult,
      });
    }

    return {
      enabled: true,
      remoteApiUrl,
      processed: results.length,
      imported,
      applied,
      results,
    };
  }

  async markTransferSyncOutboxSent(globalId: string) {
    await this.ensureTransferSyncSchema();
    const normalizedGlobalId = this.normalizeGlobalTransferId(globalId);

    const rows = await this.prisma.$queryRawUnsafe<TransferSyncOutboxRow[]>(
      `
        update dbo."TRANSFER_SYNC_OUTBOX"
        set
          "Status" = $2,
          "SentAt" = now(),
          "Attempts" = "Attempts" + 1,
          "LastError" = null
        where "GlobalId" = $1
        returning
          "GlobalId",
          "Numero",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
      `,
      normalizedGlobalId,
      TRANSFER_SYNC_STATUS_SENT,
    );

    if (!rows[0]) {
      throw new NotFoundException("El paquete de sincronizacion no existe.");
    }

    return {
      item: this.toTransferSyncOutboxView(rows[0]),
    };
  }

  async requeueTransferSyncPackage(numero: number) {
    await this.ensureTransferSyncSchema();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const transfer = await this.findTransferForSyncOrThrow(tx, numero);
        if (transfer.Status !== 1) {
          throw new ConflictException("Solo se pueden preparar para sincronizacion las transferencias aprobadas.");
        }

        const payload = await this.recordTransferSyncOutbox(tx, transfer, transfer.TotalValor);
        return payload;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      item: result,
    };
  }

  async importTransferSyncPackage(body: Record<string, unknown>) {
    await this.ensureTransferSyncSchema();
    const payload = this.normalizeTransferSyncPayload(body);

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const existingInbox = await this.getTransferSyncInboxRow(tx, payload.globalId);
          if (existingInbox?.Status === TRANSFER_SYNC_STATUS_APPLIED) {
            return {
              imported: false,
              status: TRANSFER_SYNC_STATUS_APPLIED,
              globalId: payload.globalId,
              message: "La transferencia ya habia sido aplicada en esta base.",
            };
          }

          await this.upsertTransferSyncInbox(tx, payload, TRANSFER_SYNC_STATUS_RECEIVED);

          const existingInbound = await tx.iTransferencias.findFirst({
            where: {
              Numero: payload.transfer.numero,
              CodigoEnvia: payload.transfer.codigoEnvia,
            },
          });

          if (existingInbound) {
            return {
              imported: false,
              status: existingInbox?.Status ?? TRANSFER_SYNC_STATUS_RECEIVED,
              globalId: payload.globalId,
              message: "La transferencia ya existia como entrada en esta base.",
            };
          }

          await this.ensureLocations(tx, [payload.transfer.codigoEnvia, payload.transfer.codigoRecibe]);
          await this.ensureSyncedDispatchType(tx, payload);
          await this.ensureSyncedLot(tx, payload);
          await this.prepareSyncedDestinationInventory(tx, payload);
          await this.recordSyncedInboundTransfer(tx, payload);

          return {
            imported: true,
            status: TRANSFER_SYNC_STATUS_RECEIVED,
            globalId: payload.globalId,
            numero: payload.transfer.numero,
            codigoEnvia: payload.transfer.codigoEnvia,
            codigoRecibe: payload.transfer.codigoRecibe,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return result;
    } catch (error) {
      await this.markTransferSyncInboxError(payload, this.extractSyncErrorMessage(error));
      throw error;
    }
  }

  async createTransfer(createTransferDto: CreateTransferDto, user: UserView) {
    const transferencia = await this.prisma.$transaction(
      async (tx) => {
        const normalizedDraft = await this.normalizeTransferDraft(tx, createTransferDto);
        const numero = await this.getNextTransferNumber(tx);
        const loteId = await this.resolveTransferLoteId(tx, createTransferDto.idLote, user.codUsuario);

        await this.ensureLocations(tx, [normalizedDraft.codigoEnvia, normalizedDraft.codigoRecibe]);
        await this.ensureDispatchTypeExists(tx, normalizedDraft.idDespacho);
        await this.applyOriginDelta(tx, normalizedDraft.quantitiesByBarcode);

        await tx.transferencias.create({
          data: {
            Numero: numero,
            Fecha: normalizedDraft.fecha,
            CodigoRecibe: normalizedDraft.codigoRecibe,
            CodigoEnvia: normalizedDraft.codigoEnvia,
            DocumentoOrigen: normalizedDraft.documentoOrigen || `TRF${numero}`,
            TotalValor: normalizedDraft.totalValor,
            Observacion: normalizedDraft.observacion,
            Status: 0,
            Usuario: user.codUsuario,
            InterContable: normalizedDraft.interContable,
            FechaEmision: normalizedDraft.fechaEmision,
            IDLote: loteId,
            IDDespacho: normalizedDraft.idDespacho,
            Correccion: normalizedDraft.correccion,
            Zona: normalizedDraft.zona,
          },
        });

        await tx.movTransferencias.createMany({
          data: normalizedDraft.lines.map((line) => ({
            Numero: numero,
            Fecha: line.fecha,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            Valor: line.valor,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            UltimoCosto: line.ultimoCosto,
            CostoInicial: line.costoInicial,
            CostoDolar: line.costoDolar,
          })),
        });

        await this.syncTransferCorrectionItems(
          tx,
          numero,
          normalizedDraft.lines,
          normalizedDraft.correccion,
        );
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(
          tx,
          normalizedDraft.lines.map((line) => line.codigoBarra),
        );

        return this.findTransferDetailOrThrow(tx, numero);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    const [sync, mirrorSync] = await Promise.all([
      this.pushPendingTransferSync({ limit: 25 }),
      this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }),
    ]);

    return {
      transferencia,
      sync,
      mirrorSync,
    };
  }

  async updateTransfer(numero: number, updateTransferDto: UpdateTransferDto) {
    const transferencia = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transferencias.findUnique({
          where: { Numero: numero },
          include: {
            movTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
              include: {
                inventarioRef: true,
              },
            },
          },
        });

        if (!existing) {
          throw new NotFoundException("La transferencia no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("La transferencia ya fue aprobada y no puede editarse.");
        }

        const normalizedDraft = await this.normalizeTransferDraft(tx, updateTransferDto, {
          fechaFallback: existing.Fecha,
          fechaEmisionFallback: existing.FechaEmision,
          documentoOrigenFallback: existing.DocumentoOrigen,
          observacionFallback: existing.Observacion,
          interContableFallback: existing.InterContable,
          idDespachoFallback: existing.IDDespacho,
          correccionFallback: existing.Correccion,
          zonaFallback: existing.Zona,
        });

        const loteId = await this.resolveTransferLoteId(tx, updateTransferDto.idLote ?? existing.IDLote, existing.Usuario);
        const currentQuantities = this.aggregateSavedQuantities(existing.movTransferencias);
        const originDelta = this.subtractAggregateMaps(normalizedDraft.quantitiesByBarcode, currentQuantities);

        await this.ensureLocations(tx, [normalizedDraft.codigoEnvia, normalizedDraft.codigoRecibe]);
        await this.ensureDispatchTypeExists(tx, normalizedDraft.idDespacho);
        await this.applyOriginDelta(tx, originDelta);

        await tx.transferencias.update({
          where: { Numero: numero },
          data: {
            Fecha: normalizedDraft.fecha,
            CodigoRecibe: normalizedDraft.codigoRecibe,
            CodigoEnvia: normalizedDraft.codigoEnvia,
            DocumentoOrigen: normalizedDraft.documentoOrigen || existing.DocumentoOrigen,
            TotalValor: normalizedDraft.totalValor,
            Observacion: normalizedDraft.observacion,
            InterContable: normalizedDraft.interContable,
            FechaEmision: normalizedDraft.fechaEmision,
            IDLote: loteId,
            IDDespacho: normalizedDraft.idDespacho,
            Correccion: normalizedDraft.correccion,
            Zona: normalizedDraft.zona,
          },
        });

        await tx.movTransferencias.deleteMany({
          where: { Numero: numero },
        });

        await tx.movTransferencias.createMany({
          data: normalizedDraft.lines.map((line) => ({
            Numero: numero,
            Fecha: line.fecha,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            Valor: line.valor,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            UltimoCosto: line.ultimoCosto,
            CostoInicial: line.costoInicial,
            CostoDolar: line.costoDolar,
          })),
        });

        await this.syncTransferCorrectionItems(
          tx,
          numero,
          normalizedDraft.lines,
          normalizedDraft.correccion,
        );
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(
          tx,
          [
            ...existing.movTransferencias.map((line) => line.CodigoBarra),
            ...normalizedDraft.lines.map((line) => line.codigoBarra),
          ],
        );

        return this.findTransferDetailOrThrow(tx, numero);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    const mirrorSync = await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

    return {
      transferencia,
      mirrorSync,
    };
  }

  async approveTransfer(numero: number, approveTransferDto: ApproveTransferDto = {}) {
    await this.ensureTransferSyncSchema();
    void approveTransferDto;

    const transferencia = await this.prisma.$transaction(
      async (tx) => {
        const existing = await this.findTransferForSyncOrThrow(tx, numero);

        if (existing.Status === 1) {
          throw new ConflictException("La transferencia ya fue aprobada.");
        }

        if (existing.movTransferencias.length === 0) {
          throw new BadRequestException("La transferencia no tiene renglones para aprobar.");
        }

        await this.ensureLocations(tx, [existing.CodigoEnvia, existing.CodigoRecibe]);
        const currentTotalValor = await this.refreshTransferMovementValuesFromInventory(
          tx,
          existing.movTransferencias,
        );
        const approvedAt = new Date();

        await this.applyTransferCorrectionOverridesToOrigin(tx, numero, existing.Correccion);

        await tx.transferencias.update({
          where: { Numero: numero },
          data: {
            Status: 1,
            TotalValor: currentTotalValor,
            FechaEmision: approvedAt,
          },
        });

        const approvedTransfer = await this.findTransferForSyncOrThrow(tx, numero);
        await this.recordTransferSyncOutbox(tx, approvedTransfer, currentTotalValor);
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(
          tx,
          approvedTransfer.movTransferencias.map((line) => line.CodigoBarra),
        );

        return this.findTransferDetailOrThrow(tx, numero);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    const [sync, mirrorSync] = await Promise.all([
      this.pushTransferSyncForNumero(numero),
      this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }),
    ]);

    return {
      transferencia,
      sync,
      mirrorSync,
    };
  }

  async getInventoryBulkStatus() {
    await this.ensureInventoryBulkSchema();
    const [nodes, jobs, totalItems] = await Promise.all([
      this.prisma.$queryRawUnsafe<TransferSyncNodeRow[]>(`
        select "NodeId", "SucursalCodigo", "Nombre", "Tipo", "ApiUrl", "CreatedAt", "UpdatedAt", "LastSeenAt"
        from dbo."SYNC_NODES"
        order by "SucursalCodigo" asc, "NodeId" asc
      `),
      this.getInventoryBulkJobs(),
      this.prisma.inventario.count(),
    ]);

    return {
      totalItems,
      destinations: nodes
        .filter((node) => {
          const nodeId = this.normalizeSyncNodeId(node.NodeId);
          return Boolean(node.ApiUrl) && nodeId !== DEFAULT_ORIGIN_CODE && nodeId !== "BODEGA001";
        })
        .map((node) => ({
          ...this.toTransferSyncNodeView(node),
          apiUrl: this.resolveInventoryBulkNodeApiUrl(node),
        })),
      jobs: jobs.map((job) => this.toInventoryBulkJobView(job)),
    };
  }

  async createInventoryBulkTransfer(body: Record<string, unknown>, user: UserView) {
    const isSystem = user.grupos.some(
      (group) => String(group.codigo || "").trim().toUpperCase() === "SISTEMA",
    );
    if (!isSystem) {
      throw new ConflictException("Solo el usuario sistema puede ejecutar la transferencia masiva de inventario.");
    }

    await this.ensureInventoryBulkSchema();
    const apiPort = Number(this.configService.get<string | number>("API_PORT", 3000));
    if (apiPort !== 3000) {
      throw new ConflictException("La transferencia masiva solo puede ejecutarse desde la bodega central.");
    }
    const requestedIds = Array.isArray(body.destinationNodeIds)
      ? Array.from(new Set(body.destinationNodeIds.map((value) => this.normalizeSyncNodeId(value))))
      : [];
    if (requestedIds.length === 0) {
      throw new BadRequestException("Debes seleccionar al menos una tienda o bodega destino.");
    }

    const nodes = await this.prisma.$queryRawUnsafe<TransferSyncNodeRow[]>(`
      select "NodeId", "SucursalCodigo", "Nombre", "Tipo", "ApiUrl", "CreatedAt", "UpdatedAt", "LastSeenAt"
      from dbo."SYNC_NODES"
      order by "SucursalCodigo" asc, "NodeId" asc
    `);
    const selectedNodes = requestedIds.map((nodeId) => {
      const node = nodes.find((item) => this.normalizeSyncNodeId(item.NodeId) === nodeId);
      if (!node) {
        throw new NotFoundException(`No existe el nodo destino ${nodeId}.`);
      }
      if ([DEFAULT_ORIGIN_CODE, "BODEGA001"].includes(nodeId)) {
        throw new BadRequestException("La bodega central no puede seleccionarse como destino.");
      }
      const apiUrl = this.resolveInventoryBulkNodeApiUrl(node);
      if (!apiUrl) {
        throw new ConflictException(`El nodo ${nodeId} no tiene una URL VPS configurada.`);
      }
      return { ...node, ApiUrl: apiUrl };
    });

    const activeJobs = await this.getInventoryBulkJobs([INVENTORY_BULK_STATUS_PENDING, INVENTORY_BULK_STATUS_RUNNING]);
    const activeNodeIds = new Set(activeJobs.map((job) => this.normalizeSyncNodeId(job.DestinationNodeId)));
    const duplicated = selectedNodes.find((node) => activeNodeIds.has(this.normalizeSyncNodeId(node.NodeId)));
    if (duplicated) {
      throw new ConflictException(`Ya existe una transferencia masiva activa para ${duplicated.Nombre || duplicated.NodeId}.`);
    }

    const totalItems = await this.prisma.inventario.count();
    const jobs: InventoryBulkJobRow[] = [];
    for (const node of selectedNodes) {
      const jobId = randomUUID();
      const rows = await this.prisma.$queryRawUnsafe<InventoryBulkJobRow[]>(
        `
          insert into dbo."INVENTORY_BULK_SYNC_JOBS"
            ("JobId", "DestinationNodeId", "DestinationCode", "DestinationName", "ApiUrl", "Status",
             "TotalItems", "ProcessedItems", "CursorCodigoBarra", "RequestedBy", "CreatedAt", "UpdatedAt",
             "CompletedAt", "Attempts", "LastError")
          values ($1, $2, $3, $4, $5, $6, $7, 0, null, $8, now(), now(), null, 0, null)
          returning *
        `,
        jobId,
        node.NodeId,
        node.SucursalCodigo,
        node.Nombre,
        node.ApiUrl,
        INVENTORY_BULK_STATUS_PENDING,
        totalItems,
        user.codUsuario,
      );
      jobs.push(rows[0]);
    }

    void this.processInventoryBulkJobs();
    return {
      queued: jobs.length,
      totalItems,
      jobs: jobs.map((job) => this.toInventoryBulkJobView(job)),
      message: "Transferencia masiva encolada. El servicio continuara enviando los lotes al VPS.",
    };
  }

  async importInventoryBulkBatch(body: Record<string, unknown>) {
    return this.mirrorSyncService.importInventorySnapshotBatch(body.items);
  }

  private async ensureInventoryBulkSchema() {
    await this.ensureTransferSyncSchema();
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."INVENTORY_BULK_SYNC_JOBS" (
        "JobId" varchar(80) primary key,
        "DestinationNodeId" text not null,
        "DestinationCode" varchar(30) not null,
        "DestinationName" varchar(120),
        "ApiUrl" varchar(240) not null,
        "Status" varchar(20) not null default 'PENDING',
        "TotalItems" integer not null default 0,
        "ProcessedItems" integer not null default 0,
        "CursorCodigoBarra" varchar(30),
        "RequestedBy" varchar(30) not null,
        "CreatedAt" timestamptz not null default now(),
        "UpdatedAt" timestamptz not null default now(),
        "CompletedAt" timestamptz,
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_INVENTORY_BULK_SYNC_JOBS_Status"
      on dbo."INVENTORY_BULK_SYNC_JOBS" ("Status", "CreatedAt")
    `);
  }

  private startInventoryBulkRetry() {
    if (this.inventoryBulkRetryTimer) {
      return;
    }
    setTimeout(() => void this.processInventoryBulkJobs(), 2_000);
    this.inventoryBulkRetryTimer = setInterval(
      () => void this.processInventoryBulkJobs(),
      INVENTORY_BULK_RETRY_INTERVAL_MS,
    );
  }

  private stopInventoryBulkRetry() {
    if (this.inventoryBulkRetryTimer) {
      clearInterval(this.inventoryBulkRetryTimer);
      this.inventoryBulkRetryTimer = null;
    }
  }

  private async processInventoryBulkJobs() {
    if (this.inventoryBulkProcessing) {
      return;
    }
    this.inventoryBulkProcessing = true;
    try {
      await this.ensureInventoryBulkSchema();
      const jobs = await this.getInventoryBulkJobs([INVENTORY_BULK_STATUS_PENDING, INVENTORY_BULK_STATUS_RUNNING]);
      await Promise.all(jobs.slice(0, 12).map((job) => this.processInventoryBulkJob(job)));
    } catch (error) {
      this.logger.warn(`Fallo el ciclo de transferencia masiva: ${this.extractSyncErrorMessage(error)}`);
    } finally {
      this.inventoryBulkProcessing = false;
    }
  }

  private async processInventoryBulkJob(job: InventoryBulkJobRow) {
    await this.prisma.$executeRawUnsafe(
      `update dbo."INVENTORY_BULK_SYNC_JOBS" set "Status" = $2, "UpdatedAt" = now() where "JobId" = $1`,
      job.JobId,
      INVENTORY_BULK_STATUS_RUNNING,
    );

    let cursor = job.CursorCodigoBarra;
    let processed = job.ProcessedItems;
    try {
      while (true) {
        const batch = await this.mirrorSyncService.getInventorySnapshotBatch({
          afterCodigoBarra: cursor,
          take: INVENTORY_BULK_BATCH_SIZE,
          jobId: job.JobId,
        });
        if (batch.items.length > 0) {
          await this.postInventoryBulkBatch(job.ApiUrl, job.JobId, batch.items);
          processed += batch.items.length;
          cursor = batch.lastCodigoBarra;
        }

        const completed = batch.completed;
        await this.prisma.$executeRawUnsafe(
          `
            update dbo."INVENTORY_BULK_SYNC_JOBS"
            set "Status" = $2, "ProcessedItems" = $3, "CursorCodigoBarra" = $4,
                "UpdatedAt" = now(), "CompletedAt" = case when $2 = $5 then now() else null end,
                "LastError" = null
            where "JobId" = $1
          `,
          job.JobId,
          completed ? INVENTORY_BULK_STATUS_COMPLETED : INVENTORY_BULK_STATUS_RUNNING,
          processed,
          cursor || null,
          INVENTORY_BULK_STATUS_COMPLETED,
        );
        if (completed) {
          break;
        }
      }
    } catch (error) {
      const message = this.extractSyncErrorMessage(error);
      await this.prisma.$executeRawUnsafe(
        `
          update dbo."INVENTORY_BULK_SYNC_JOBS"
          set "Status" = case when "Attempts" + 1 >= 10 then $2 else $3 end,
              "ProcessedItems" = $4, "CursorCodigoBarra" = $5, "UpdatedAt" = now(),
              "Attempts" = "Attempts" + 1, "LastError" = $6
          where "JobId" = $1
        `,
        job.JobId,
        INVENTORY_BULK_STATUS_ERROR,
        INVENTORY_BULK_STATUS_PENDING,
        processed,
        cursor || null,
        message,
      );
      this.logger.warn(`Transferencia masiva ${job.JobId} pendiente: ${message}`);
    }
  }

  private resolveInventoryBulkNodeApiUrl(node: TransferSyncNodeRow) {
    const configuredBase = this.normalizeOptionalApiUrl(
      this.configService.get<string>("TRANSFER_SYNC_REMOTE_API_URL", "") ||
        this.configService.get<string>("MIRROR_SYNC_REMOTE_API_URL", ""),
    );
    if (configuredBase) {
      const parsed = new URL(configuredBase);
      parsed.pathname = parsed.pathname.replace(/\/(?:tienda|bodega)\d{3}\/?$/i, "").replace(/\/$/, "");
      const root = parsed.toString().replace(/\/$/, "");
      const nodeId = this.normalizeSyncNodeId(node.NodeId);
      const tienda = nodeId.match(/^TIENDA(\d+)$/);
      if (tienda) {
        return `${root}/tienda${tienda[1].padStart(3, "0")}`;
      }
      const bodega = nodeId.match(/^BODEGA(\d+)$/);
      if (bodega) {
        return `${root}/bodega${bodega[1].padStart(3, "0")}`;
      }
    }
    return this.normalizeOptionalApiUrl(node.ApiUrl);
  }

  private async postInventoryBulkBatch(apiUrl: string, jobId: string, items: unknown[]) {
    const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
    const token = await this.loginRemoteSyncNode(baseUrl);
    const response = await fetch(`${baseUrl}/api/transfers/inventory-bulk/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId, items }),
    });
    const responseBody = await this.readRemoteJson(response);
    if (!response.ok) {
      throw new ConflictException(
        `El VPS rechazo el lote masivo: ${this.formatRemoteError(responseBody, response.status)}`,
      );
    }
    return responseBody;
  }

  private async getInventoryBulkJobs(statuses: string[] = []) {
    if (statuses.length === 0) {
      return this.prisma.$queryRawUnsafe<InventoryBulkJobRow[]>(`
        select * from dbo."INVENTORY_BULK_SYNC_JOBS" order by "CreatedAt" desc limit 50
      `);
    }
    return this.prisma.$queryRawUnsafe<InventoryBulkJobRow[]>(
      `
        select * from dbo."INVENTORY_BULK_SYNC_JOBS"
        where "Status" = any($1::varchar[])
        order by "CreatedAt" asc
      `,
      statuses,
    );
  }

  private toInventoryBulkJobView(job: InventoryBulkJobRow) {
    return {
      jobId: job.JobId,
      destinationNodeId: job.DestinationNodeId,
      destinationCode: job.DestinationCode,
      destinationName: job.DestinationName,
      apiUrl: job.ApiUrl,
      status: job.Status,
      totalItems: job.TotalItems,
      processedItems: job.ProcessedItems,
      requestedBy: job.RequestedBy,
      createdAt: job.CreatedAt,
      updatedAt: job.UpdatedAt,
      completedAt: job.CompletedAt,
      attempts: job.Attempts,
      lastError: job.LastError,
    };
  }

  private startTransferSyncAutoRetry() {
    if (!this.isTransferSyncAutoRetryEnabled()) {
      this.logger.log("Reintento automatico de sincronizacion de transferencias deshabilitado.");
      return;
    }

    if (this.transferSyncAutoRetryTimer) {
      return;
    }

    const intervalMs = this.getTransferSyncAutoRetryIntervalMs();
    const startupDelayMs = this.getTransferSyncAutoRetryStartupDelayMs();

    this.transferSyncAutoRetryStartupTimer = setTimeout(() => {
      this.transferSyncAutoRetryStartupTimer = null;
      void this.runTransferSyncAutoRetryCycle("startup");
    }, startupDelayMs);

    this.transferSyncAutoRetryTimer = setInterval(() => {
      void this.runTransferSyncAutoRetryCycle("interval");
    }, intervalMs);

    this.logger.log(
      `Reintento automatico de sincronizacion de transferencias activo cada ${intervalMs} ms.`,
    );
  }

  private stopTransferSyncAutoRetry() {
    if (this.transferSyncAutoRetryStartupTimer) {
      clearTimeout(this.transferSyncAutoRetryStartupTimer);
      this.transferSyncAutoRetryStartupTimer = null;
    }

    if (this.transferSyncAutoRetryTimer) {
      clearInterval(this.transferSyncAutoRetryTimer);
      this.transferSyncAutoRetryTimer = null;
    }
  }

  private async runTransferSyncAutoRetryCycle(reason: "startup" | "interval") {
    if (this.transferSyncAutoRetryInProgress) {
      return;
    }

    this.transferSyncAutoRetryInProgress = true;

    try {
      const pushSync = await this.pushPendingTransferSync({
        limit: this.getTransferSyncAutoRetryLimit(),
      });
      const pullSync = await this.pullRemoteTransferSync({
        limit: this.getTransferSyncAutoRetryLimit(),
      });

      if (pushSync.processed > 0 || pullSync.processed > 0) {
        const sent = pushSync.results.filter((item) => item.status === TRANSFER_SYNC_STATUS_SENT).length;
        const pending = pushSync.results.filter((item) => item.status === TRANSFER_SYNC_STATUS_PENDING).length;
        this.logger.log(
          `Reintento automatico de transferencias (${reason}): push=${pushSync.processed} (${sent} enviado(s), ${pending} pendiente(s)); pull=${pullSync.processed} (${pullSync.imported} importado(s), ${pullSync.applied} aplicado(s)).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Fallo el reintento automatico de sincronizacion de transferencias (${reason}).`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.transferSyncAutoRetryInProgress = false;
    }
  }

  async deletePendingTransfer(numero: number) {
    await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transferencias.findUnique({
          where: { Numero: numero },
          include: {
            movTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
            },
          },
        });

        if (!existing) {
          throw new NotFoundException("La transferencia no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("La transferencia ya fue aprobada y no puede eliminarse.");
        }

        await this.applyOriginDelta(
          tx,
          this.negateAggregateMap(this.aggregateSavedQuantities(existing.movTransferencias)),
        );

        await tx.movTransferencias.deleteMany({
          where: { Numero: numero },
        });

        await tx.$executeRawUnsafe(
          `
            delete from dbo."TRANSFER_CORRECTION_ITEMS"
            where "Numero" = $1
          `,
          numero,
        );

        await tx.transferencias.delete({
          where: { Numero: numero },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      deleted: true,
      numero,
    };
  }

  private async ensureTransferSyncSchema(client: PrismaService | TransferTransactionClient = this.prisma) {
    await client.$executeRawUnsafe(`
      create table if not exists dbo."SYNC_NODES" (
        "NodeId" text primary key,
        "SucursalCodigo" varchar(15) not null,
        "Nombre" varchar(80),
        "Tipo" varchar(20),
        "CreatedAt" timestamptz not null default now(),
        "UpdatedAt" timestamptz not null default now(),
        "LastSeenAt" timestamptz
      )
    `);

    await client.$executeRawUnsafe(`
      create unique index if not exists "UX_SYNC_NODES_SucursalCodigo"
      on dbo."SYNC_NODES" ("SucursalCodigo")
    `);

    await client.$executeRawUnsafe(`
      alter table dbo."SYNC_NODES"
      add column if not exists "ApiUrl" varchar(200)
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."TRANSFER_SYNC_OUTBOX" (
        "GlobalId" text primary key,
        "Numero" integer not null,
        "CodigoEnvia" varchar(15) not null,
        "CodigoRecibe" varchar(15) not null,
        "SourceNodeId" text not null,
        "DestinationNodeId" text not null,
        "EventType" varchar(40) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null default 'PENDING',
        "CreatedAt" timestamptz not null default now(),
        "SentAt" timestamptz,
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_TRANSFER_SYNC_OUTBOX_Status"
      on dbo."TRANSFER_SYNC_OUTBOX" ("Status", "CreatedAt")
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."TRANSFER_SYNC_INBOX" (
        "GlobalId" text primary key,
        "NumeroOrigen" integer not null,
        "CodigoEnvia" varchar(15) not null,
        "CodigoRecibe" varchar(15) not null,
        "SourceNodeId" text not null,
        "DestinationNodeId" text not null,
        "EventType" varchar(40) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null default 'RECEIVED',
        "ReceivedAt" timestamptz not null default now(),
        "AppliedAt" timestamptz,
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_TRANSFER_SYNC_INBOX_Status"
      on dbo."TRANSFER_SYNC_INBOX" ("Status", "ReceivedAt")
    `);
    await this.ensureTransferCorrectionSchema(client);
  }

  private async ensureTransferCorrectionSchema(
    client: PrismaService | TransferTransactionClient = this.prisma,
  ) {
    await client.$executeRawUnsafe(`
      create table if not exists dbo."TRANSFER_CORRECTION_ITEMS" (
        "Numero" integer not null,
        "Item" integer not null,
        "NumeroCaja" integer not null,
        "CodigoBarra" varchar(30) not null,
        "Referencia" varchar(30) not null,
        "CreatedAt" timestamptz not null default now(),
        "UpdatedAt" timestamptz not null default now(),
        primary key ("Numero", "Item", "NumeroCaja", "CodigoBarra")
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_TRANSFER_CORRECTION_ITEMS_Numero"
      on dbo."TRANSFER_CORRECTION_ITEMS" ("Numero")
    `);
  }

  private async findTransferForSyncOrThrow(
    tx: TransferTransactionClient,
    numero: number,
  ): Promise<TransferForSync> {
    const transfer = await tx.transferencias.findUnique({
      where: { Numero: numero },
      include: {
        lote: true,
        tipoDespacho: true,
        sucursalRecibe: true,
        movTransferencias: {
          orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
          include: {
            inventarioRef: {
              include: {
                marcaRef: true,
                tallaRef: true,
                colorRef: true,
                fabricanteRef: true,
                categoriaRef: true,
                impuestoRef: true,
              },
            },
          },
        },
      },
    });

    if (!transfer) {
      throw new NotFoundException("La transferencia no existe.");
    }

    return transfer;
  }

  private async getTransferSyncOutboxRows(status: string, limit: number) {
    return this.prisma.$queryRawUnsafe<TransferSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "Numero",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_OUTBOX"
        where "Status" = $1
        order by "CreatedAt" asc
        limit $2
      `,
      status,
      limit,
    );
  }

  private async getPendingTransferSyncRowsByNumero(numero: number) {
    return this.prisma.$queryRawUnsafe<TransferSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "Numero",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_OUTBOX"
        where "Numero" = $1 and "Status" = $2
        order by "CreatedAt" desc
      `,
      numero,
      TRANSFER_SYNC_STATUS_PENDING,
    );
  }

  private async pushTransferSyncForNumero(numero: number) {
    const rows = await this.getPendingTransferSyncRowsByNumero(numero);
    const results = await this.pushTransferSyncRows(rows);

    return {
      processed: results.length,
      results,
    };
  }

  private async pushTransferSyncRows(rows: TransferSyncOutboxRow[]) {
    const results = [];

    for (const row of rows) {
      try {
        const destination = await this.resolveDestinationSyncNode(row);
        if (!destination.ApiUrl) {
          throw new ConflictException(
            `El nodo destino ${row.DestinationNodeId || row.CodigoRecibe} no tiene apiUrl configurada.`,
          );
        }

        const response = await this.postTransferSyncPackage(destination.ApiUrl, row.Payload);
        const sent = await this.updateTransferSyncOutboxStatus(
          row.GlobalId,
          TRANSFER_SYNC_STATUS_SENT,
          null,
        );

        results.push({
          globalId: row.GlobalId,
          numero: row.Numero,
          codigoRecibe: row.CodigoRecibe,
          status: sent.Status,
          destino: this.toTransferSyncNodeView(destination),
          respuestaDestino: response,
        });
      } catch (error) {
        const message = this.extractSyncErrorMessage(error);
        this.logger.warn(`No se pudo sincronizar ${row.GlobalId}: ${message}`);
        await this.updateTransferSyncOutboxStatus(
          row.GlobalId,
          TRANSFER_SYNC_STATUS_PENDING,
          message,
        );
        results.push({
          globalId: row.GlobalId,
          numero: row.Numero,
          codigoRecibe: row.CodigoRecibe,
          status: TRANSFER_SYNC_STATUS_PENDING,
          error: message,
        });
      }
    }

    return results;
  }

  private async updateTransferSyncOutboxStatus(
    globalId: string,
    status: string,
    lastError: string | null,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<TransferSyncOutboxRow[]>(
      `
        update dbo."TRANSFER_SYNC_OUTBOX"
        set
          "Status" = $2,
          "SentAt" = case when $2 = $3 then now() else "SentAt" end,
          "Attempts" = "Attempts" + 1,
          "LastError" = $4
        where "GlobalId" = $1
        returning
          "GlobalId",
          "Numero",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
      `,
      globalId,
      status,
      TRANSFER_SYNC_STATUS_SENT,
      lastError,
    );

    if (!rows[0]) {
      throw new NotFoundException("El paquete de sincronizacion no existe.");
    }

    return rows[0];
  }

  private async resolveDestinationSyncNode(row: TransferSyncOutboxRow) {
    const rows = await this.prisma.$queryRawUnsafe<TransferSyncNodeRow[]>(
      `
        select
          "NodeId",
          "SucursalCodigo",
          "Nombre",
          "Tipo",
          "ApiUrl",
          "CreatedAt",
          "UpdatedAt",
          "LastSeenAt"
        from dbo."SYNC_NODES"
        where
          upper("NodeId") = upper($1)
          or upper("SucursalCodigo") = upper($1)
          or upper("SucursalCodigo") = upper($2)
        order by
          case
            when upper("NodeId") = upper($1) then 0
            when upper("SucursalCodigo") = upper($1) then 1
            else 2
          end
        limit 1
      `,
      row.DestinationNodeId,
      row.CodigoRecibe,
    );

    if (!rows[0]) {
      throw new NotFoundException(`No existe nodo de sincronizacion para la sucursal ${row.CodigoRecibe}.`);
    }

    const destination = rows[0];
    return {
      ...destination,
      ApiUrl: this.resolveTransferSyncDestinationApiUrl(destination),
    };
  }

  private resolveTransferSyncDestinationApiUrl(node: TransferSyncNodeRow) {
    const configuredBase = this.normalizeOptionalApiUrl(
      this.configService.get<string>("TRANSFER_SYNC_REMOTE_API_URL", "") ||
        this.configService.get<string>("MIRROR_SYNC_REMOTE_API_URL", ""),
    );
    if (!configuredBase) {
      return this.normalizeOptionalApiUrl(node.ApiUrl);
    }

    const parsed = new URL(configuredBase);
    parsed.pathname = parsed.pathname.replace(/\/(?:tienda|bodega)\d{3}\/?$/i, "").replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    const root = parsed.toString().replace(/\/$/, "");
    const nodeId = this.normalizeSyncNodeId(node.NodeId);

    if (nodeId === DEFAULT_ORIGIN_CODE || nodeId === "BODEGA001") {
      return root;
    }

    const tienda = nodeId.match(/^TIENDA(\d+)$/);
    if (tienda) {
      return `${root}/tienda${tienda[1].padStart(3, "0")}`;
    }

    const bodega = nodeId.match(/^BODEGA(\d+)$/);
    if (bodega) {
      return `${root}/bodega${bodega[1].padStart(3, "0")}`;
    }

    return this.normalizeOptionalApiUrl(node.ApiUrl);
  }

  private async postTransferSyncPackage(apiUrl: string, payload: unknown) {
    const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
    const token = await this.loginRemoteSyncNode(baseUrl);
    const response = await fetch(`${baseUrl}/api/transfers/sync/import`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await this.readRemoteJson(response);
    if (!response.ok) {
      throw new ConflictException(
        `Destino rechazo la transferencia: ${this.formatRemoteError(responseBody, response.status)}`,
      );
    }

    return responseBody;
  }

  private async loginRemoteSyncNode(baseUrl: string) {
    let lastErrorMessage = "Usuario o clave inválidos";
    let lastStatus = 401;

    for (const candidate of this.getRemoteSyncCredentialCandidates()) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(candidate),
      });
      const body = await this.readRemoteJson(response);

      if (response.ok && this.isRecord(body) && typeof body.accessToken === "string") {
        return body.accessToken;
      }

      lastErrorMessage = this.formatRemoteError(body, response.status);
      lastStatus = response.status;
    }

    throw new ConflictException(
      `No se pudo autenticar contra el nodo destino: ${this.formatRemoteError(lastErrorMessage, lastStatus)}`,
    );
  }

  private getRemoteSyncCredentialCandidates() {
    const preferredUsername = this.configService.get<string>("TRANSFER_SYNC_USERNAME", "admin");
    const preferredPassword = this.configService.get<string>("TRANSFER_SYNC_PASSWORD", "123456");
    const bootstrapAdminUsername = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_USERNAME", "admin");
    const bootstrapAdminPassword = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "123456");
    const candidates = [
      { usuario: preferredUsername, password: preferredPassword },
      { usuario: bootstrapAdminUsername, password: bootstrapAdminPassword },
      { usuario: "admin", password: "789456" },
      { usuario: "admin", password: "123456" },
    ];

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const usuario = String(candidate.usuario || "").trim();
      const password = String(candidate.password || "").trim();
      if (!usuario || !password) {
        return false;
      }

      const key = `${usuario}::${password}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
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
      const message = body.message;
      if (Array.isArray(message)) {
        return message.join("; ");
      }

      if (typeof message === "string") {
        return message;
      }

      if (typeof body.error === "string") {
        return body.error;
      }
    }

    if (typeof body === "string") {
      return body;
    }

    return `HTTP ${status}`;
  }

  private async recordTransferSyncOutbox(
    tx: TransferTransactionClient,
    transfer: TransferForSync,
    totalValor: Prisma.Decimal,
  ) {
    const sourceNodeId = await this.resolveTransferSyncNodeId(tx, transfer.CodigoEnvia);
    const destinationNodeId = await this.resolveTransferSyncNodeId(tx, transfer.CodigoRecibe);
    const globalId = this.buildTransferGlobalId(sourceNodeId, transfer.Numero);
    const payload = this.buildTransferSyncPayload(transfer, totalValor, {
      globalId,
      sourceNodeId,
      destinationNodeId,
    });

    await tx.$executeRawUnsafe(
      `
        insert into dbo."TRANSFER_SYNC_OUTBOX"
          (
            "GlobalId",
            "Numero",
            "CodigoEnvia",
            "CodigoRecibe",
            "SourceNodeId",
            "DestinationNodeId",
            "EventType",
            "Payload",
            "Status",
            "CreatedAt",
            "SentAt",
            "Attempts",
            "LastError"
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), null, 0, null)
        on conflict ("GlobalId") do update set
          "Numero" = excluded."Numero",
          "CodigoEnvia" = excluded."CodigoEnvia",
          "CodigoRecibe" = excluded."CodigoRecibe",
          "SourceNodeId" = excluded."SourceNodeId",
          "DestinationNodeId" = excluded."DestinationNodeId",
          "EventType" = excluded."EventType",
          "Payload" = excluded."Payload",
          "Status" = excluded."Status",
          "SentAt" = null,
          "LastError" = null
      `,
      payload.globalId,
      transfer.Numero,
      transfer.CodigoEnvia,
      transfer.CodigoRecibe,
      sourceNodeId,
      destinationNodeId,
      TRANSFER_SYNC_EVENT_APPROVED,
      JSON.stringify(payload),
      TRANSFER_SYNC_STATUS_PENDING,
    );

    return this.toTransferSyncOutboxView({
      GlobalId: payload.globalId,
      Numero: transfer.Numero,
      CodigoEnvia: transfer.CodigoEnvia,
      CodigoRecibe: transfer.CodigoRecibe,
      SourceNodeId: sourceNodeId,
      DestinationNodeId: destinationNodeId,
      EventType: TRANSFER_SYNC_EVENT_APPROVED,
      Payload: payload,
      Status: TRANSFER_SYNC_STATUS_PENDING,
      CreatedAt: new Date(),
      SentAt: null,
      Attempts: 0,
      LastError: null,
    });
  }

  private buildTransferSyncPayload(
    transfer: TransferForSync,
    totalValor: Prisma.Decimal,
    ids: { globalId: string; sourceNodeId: string; destinationNodeId: string },
  ): TransferSyncPayload {
    return {
      schemaVersion: TRANSFER_SYNC_SCHEMA_VERSION,
      eventType: TRANSFER_SYNC_EVENT_APPROVED,
      globalId: ids.globalId,
      sourceNodeId: ids.sourceNodeId,
      destinationNodeId: ids.destinationNodeId,
      transfer: {
        numero: transfer.Numero,
        fecha: this.toIsoString(transfer.Fecha),
        fechaEmision: this.toIsoString(transfer.FechaEmision),
        codigoEnvia: transfer.CodigoEnvia,
        codigoRecibe: transfer.CodigoRecibe,
        documentoOrigen: transfer.DocumentoOrigen,
        totalValor: totalValor.toString(),
        observacion: transfer.Observacion,
        status: 1,
        usuario: transfer.Usuario,
        interContable: transfer.InterContable,
        idLote: transfer.IDLote,
        lote: {
          id: transfer.lote.ID,
          lote: transfer.lote.Lote,
          descripcion: transfer.lote.Descripcion,
          estado: transfer.lote.Estado,
        },
        idDespacho: transfer.IDDespacho,
        tipoDespacho: {
          id: transfer.tipoDespacho.ID,
          descripcion: transfer.tipoDespacho.Descripcion,
          estado: transfer.tipoDespacho.Estado,
        },
        correccion: transfer.Correccion,
        zona: transfer.Zona,
      },
      items: transfer.movTransferencias.map((line) => ({
        item: line.Item,
        fecha: line.Fecha ? this.toIsoString(line.Fecha) : null,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
        numeroCaja: line.NumeroCaja,
        ultimoCosto: line.UltimoCosto?.toString() ?? null,
        costoInicial: line.CostoInicial?.toString() ?? null,
        costoDolar: line.CostoDolar?.toString() ?? null,
        articulo: this.serializeInventoryForSync(line.inventarioRef),
      })),
    };
  }

  private serializeInventoryForSync(
    article: TransferForSync["movTransferencias"][number]["inventarioRef"],
  ): TransferSyncInventoryPayload {
    return {
      codigoBarra: article.CodigoBarra,
      referencia: article.Referencia,
      codigoMarca: article.CodigoMarca,
      nombre: article.Nombre,
      talla: article.Talla,
      codigoColor: article.CodigoColor,
      fabricante: article.Fabricante,
      categoria: article.Categoria,
      nota: article.Nota,
      tipoImpuesto: article.TipoImpuesto,
      precioDetal: article.PrecioDetal.toString(),
      precioMayor: article.PrecioMayor.toString(),
      precioAfiliado: article.PrecioAfiliado.toString(),
      precioPromocion: article.PrecioPromocion.toString(),
      promocion: article.Promocion,
      fechaInicial: this.toIsoString(article.FechaInicial),
      fechaFinal: this.toIsoString(article.FechaFinal),
      costoInicial: article.CostoInicial.toString(),
      costoPromedio: article.CostoPromedio.toString(),
      ultimoCosto: article.UltimoCosto.toString(),
      costoDolar: article.CostoDolar.toString(),
      existenciaInicial: article.ExistenciaInicial.toString(),
      puntoReorden: article.PuntoReorden.toString(),
      tipo: article.Tipo,
      status: article.Status,
      serializado: article.Serializado,
      codigoBarraAnt: article.CodigoBarraAnt,
      catalogs: {
        marca: {
          codigo: article.marcaRef.Codigo,
          nombre: article.marcaRef.Nombre,
          status: article.marcaRef.Status,
        },
        talla: {
          codigo: article.tallaRef.Codigo,
        },
        color: {
          codigo: article.colorRef.Codigo,
          nombre: article.colorRef.Nombre,
          status: article.colorRef.Status,
        },
        fabricante: {
          codigo: article.fabricanteRef.Codigo,
          nombre: article.fabricanteRef.Nombre,
          status: article.fabricanteRef.Status,
        },
        categoria: {
          codigo: article.categoriaRef.Codigo,
          nombre: article.categoriaRef.Nombre,
          status: article.categoriaRef.Status,
        },
        impuesto: {
          codigo: article.impuestoRef.Codigo,
          nombre: article.impuestoRef.Nombre,
          porcentajeImpuesto: article.impuestoRef.PorcentajeImpuesto?.toString() ?? null,
        },
      },
    };
  }

  private normalizeTransferSyncPayload(body: Record<string, unknown>): TransferSyncPayload {
    const candidate = this.isRecord(body.payload) ? body.payload : body;
    if (!this.isRecord(candidate)) {
      throw new BadRequestException("Paquete de sincronizacion invalido.");
    }

    const transfer = candidate.transfer;
    const items = candidate.items;
    if (!this.isRecord(transfer) || !Array.isArray(items)) {
      throw new BadRequestException("El paquete de transferencia no tiene cabecera o renglones validos.");
    }

    const schemaVersion = Number(candidate.schemaVersion);
    if (schemaVersion !== TRANSFER_SYNC_SCHEMA_VERSION) {
      throw new BadRequestException("La version del paquete de sincronizacion no es compatible.");
    }

    const eventType = String(candidate.eventType || "").trim().toUpperCase();
    if (eventType !== TRANSFER_SYNC_EVENT_APPROVED) {
      throw new BadRequestException("Solo se pueden importar transferencias aprobadas.");
    }

    const payload: TransferSyncPayload = {
      schemaVersion,
      eventType: TRANSFER_SYNC_EVENT_APPROVED,
      globalId: this.normalizeGlobalTransferId(candidate.globalId),
      sourceNodeId: this.normalizeSyncNodeId(candidate.sourceNodeId),
      destinationNodeId: this.normalizeSyncNodeId(candidate.destinationNodeId),
      transfer: {
        numero: this.toPositiveInteger(transfer.numero, "Numero de transferencia invalido."),
        fecha: this.toRequiredIsoString(transfer.fecha, "Fecha de transferencia invalida."),
        fechaEmision: this.toRequiredIsoString(transfer.fechaEmision, "Fecha de emision invalida."),
        codigoEnvia: this.normalizeRequiredCode(transfer.codigoEnvia as string | undefined, "Codigo de origen invalido."),
        codigoRecibe: this.normalizeRequiredCode(transfer.codigoRecibe as string | undefined, "Codigo de destino invalido."),
        documentoOrigen: String(transfer.documentoOrigen || "").trim(),
        totalValor: this.parseNonNegativeDecimal(
          String(transfer.totalValor || "0"),
          "Total de transferencia invalido.",
        ).toString(),
        observacion: String(transfer.observacion || "").trim(),
        status: 1,
        usuario: transfer.usuario ? String(transfer.usuario).trim() : null,
        interContable: transfer.interContable === null || transfer.interContable === undefined
          ? null
          : Number(transfer.interContable),
        idLote: this.toNonNegativeInteger(transfer.idLote, "Lote de transferencia invalido."),
        lote: this.normalizeTransferSyncLot(transfer.lote),
        idDespacho: this.toNonNegativeInteger(transfer.idDespacho, "Despacho de transferencia invalido."),
        tipoDespacho: this.normalizeTransferSyncDispatch(transfer.tipoDespacho),
        correccion: Boolean(transfer.correccion),
        zona: String(transfer.zona || "").trim(),
      },
      items: items.map((line, index) => this.normalizeTransferSyncLine(line, index)),
    };

    if (payload.items.length === 0) {
      throw new BadRequestException("El paquete de transferencia no tiene renglones.");
    }

    return payload;
  }

  private normalizeTransferSyncLine(line: unknown, index: number): TransferSyncLinePayload {
    if (!this.isRecord(line) || !this.isRecord(line.articulo)) {
      throw new BadRequestException(`Renglon ${index + 1} de sincronizacion invalido.`);
    }

    const codigoBarra = this.normalizeRequiredCode(
      line.codigoBarra as string | undefined,
      `Codigo de barra invalido en el renglon ${index + 1}.`,
    );

    return {
      item: this.toPositiveInteger(line.item, `Item invalido en el renglon ${index + 1}.`),
      fecha: line.fecha ? this.toRequiredIsoString(line.fecha, `Fecha invalida en el renglon ${index + 1}.`) : null,
      codigoBarra,
      cantidad: this.parsePositiveDecimal(
        String(line.cantidad || "0"),
        `Cantidad invalida en el renglon ${index + 1}.`,
      ).toString(),
      valor: this.parseNonNegativeDecimal(
        String(line.valor || "0"),
        `Valor invalido en el renglon ${index + 1}.`,
      ).toString(),
      numeroCaja: this.toNonNegativeInteger(line.numeroCaja, `Caja invalida en el renglon ${index + 1}.`),
      ultimoCosto: line.ultimoCosto === null || line.ultimoCosto === undefined
        ? null
        : this.parseNonNegativeDecimal(String(line.ultimoCosto), `Ultimo costo invalido en el renglon ${index + 1}.`).toString(),
      costoInicial: line.costoInicial === null || line.costoInicial === undefined
        ? null
        : this.parseNonNegativeDecimal(String(line.costoInicial), `Costo inicial invalido en el renglon ${index + 1}.`).toString(),
      costoDolar: line.costoDolar === null || line.costoDolar === undefined
        ? null
        : this.parseNonNegativeDecimal(String(line.costoDolar), `Costo dolar invalido en el renglon ${index + 1}.`).toString(),
      articulo: this.normalizeTransferSyncInventory(line.articulo, codigoBarra, index),
    };
  }

  private normalizeTransferSyncInventory(
    article: Record<string, unknown>,
    codigoBarra: string,
    index: number,
  ): TransferSyncInventoryPayload {
    const catalogs = this.isRecord(article.catalogs) ? article.catalogs : {};
    const tipoImpuesto = this.toNonNegativeInteger(article.tipoImpuesto, `Impuesto invalido en el renglon ${index + 1}.`);

    return {
      codigoBarra,
      referencia: this.normalizeRequiredCode(article.referencia as string | undefined, `Referencia invalida en el renglon ${index + 1}.`),
      codigoMarca: this.normalizeRequiredCode(article.codigoMarca as string | undefined, `Marca invalida en el renglon ${index + 1}.`),
      nombre: String(article.nombre || codigoBarra).trim(),
      talla: this.normalizeRequiredCode(article.talla as string | undefined, `Talla invalida en el renglon ${index + 1}.`),
      codigoColor: this.normalizeRequiredCode(article.codigoColor as string | undefined, `Color invalido en el renglon ${index + 1}.`),
      fabricante: this.normalizeRequiredCode(article.fabricante as string | undefined, `Fabricante invalido en el renglon ${index + 1}.`),
      categoria: this.normalizeRequiredCode(article.categoria as string | undefined, `Categoria invalida en el renglon ${index + 1}.`),
      nota: article.nota === null || article.nota === undefined ? null : String(article.nota),
      tipoImpuesto,
      precioDetal: this.parseNonNegativeDecimal(String(article.precioDetal || "0"), `Precio detal invalido en el renglon ${index + 1}.`).toString(),
      precioMayor: this.parseNonNegativeDecimal(String(article.precioMayor || "0"), `Precio mayor invalido en el renglon ${index + 1}.`).toString(),
      precioAfiliado: this.parseNonNegativeDecimal(String(article.precioAfiliado || "0"), `Precio afiliado invalido en el renglon ${index + 1}.`).toString(),
      precioPromocion: this.parseNonNegativeDecimal(String(article.precioPromocion || "0"), `Precio promocion invalido en el renglon ${index + 1}.`).toString(),
      promocion: Boolean(article.promocion),
      fechaInicial: this.toRequiredIsoString(article.fechaInicial, `Fecha inicial invalida en el renglon ${index + 1}.`),
      fechaFinal: this.toRequiredIsoString(article.fechaFinal, `Fecha final invalida en el renglon ${index + 1}.`),
      costoInicial: this.parseNonNegativeDecimal(String(article.costoInicial || "0"), `Costo inicial invalido en el renglon ${index + 1}.`).toString(),
      costoPromedio: this.parseNonNegativeDecimal(String(article.costoPromedio || "0"), `Costo promedio invalido en el renglon ${index + 1}.`).toString(),
      ultimoCosto: this.parseNonNegativeDecimal(String(article.ultimoCosto || "0"), `Ultimo costo invalido en el renglon ${index + 1}.`).toString(),
      costoDolar: this.parseNonNegativeDecimal(String(article.costoDolar || "0"), `Costo dolar invalido en el renglon ${index + 1}.`).toString(),
      existenciaInicial: this.parseNonNegativeDecimal(String(article.existenciaInicial || "0"), `Existencia inicial invalida en el renglon ${index + 1}.`).toString(),
      puntoReorden: this.parseNonNegativeDecimal(String(article.puntoReorden || "0"), `Punto de reorden invalido en el renglon ${index + 1}.`).toString(),
      tipo: this.toNonNegativeInteger(article.tipo, `Tipo invalido en el renglon ${index + 1}.`),
      status: this.toNonNegativeInteger(article.status, `Status invalido en el renglon ${index + 1}.`),
      serializado: this.toNonNegativeInteger(article.serializado, `Serializado invalido en el renglon ${index + 1}.`),
      codigoBarraAnt: String(article.codigoBarraAnt || codigoBarra).trim(),
      catalogs: {
        marca: this.normalizeCatalogPayload(catalogs.marca, article.codigoMarca, article.codigoMarca),
        talla: this.normalizeCatalogPayload(catalogs.talla, article.talla, article.talla),
        color: this.normalizeCatalogPayload(catalogs.color, article.codigoColor, article.codigoColor),
        fabricante: this.normalizeCatalogPayload(catalogs.fabricante, article.fabricante, article.fabricante),
        categoria: this.normalizeCatalogPayload(catalogs.categoria, article.categoria, article.categoria),
        impuesto: this.normalizeCatalogPayload(catalogs.impuesto, tipoImpuesto, `IVA ${tipoImpuesto}`),
      },
    };
  }

  private normalizeCatalogPayload(
    value: unknown,
    fallbackCode: unknown,
    fallbackName: unknown,
  ): TransferSyncCatalogPayload {
    const record = this.isRecord(value) ? value : {};
    const codigo = record.codigo ?? fallbackCode;
    const nombre = record.nombre === null || record.nombre === undefined
      ? String(fallbackName ?? codigo ?? "").trim()
      : String(record.nombre).trim();
    const status = record.status === null || record.status === undefined ? 1 : Number(record.status);

    return {
      codigo: typeof codigo === "number" ? codigo : String(codigo || "").trim().toUpperCase(),
      nombre,
      status: Number.isFinite(status) ? status : 1,
      porcentajeImpuesto: record.porcentajeImpuesto === null || record.porcentajeImpuesto === undefined
        ? null
        : this.parseNonNegativeDecimal(String(record.porcentajeImpuesto), "Porcentaje de impuesto invalido.").toString(),
    };
  }

  private normalizeTransferSyncLot(value: unknown) {
    const record = this.isRecord(value) ? value : {};
    const id = this.toNonNegativeInteger(record.id, "Lote de transferencia invalido.");
    return {
      id,
      lote: String(record.lote || `SYNC_LOTE_${id}`).trim(),
      descripcion: record.descripcion === null || record.descripcion === undefined
        ? "Lote sincronizado desde transferencia"
        : String(record.descripcion).trim(),
      estado: record.estado === null || record.estado === undefined ? 1 : Number(record.estado),
    };
  }

  private normalizeTransferSyncDispatch(value: unknown) {
    const record = this.isRecord(value) ? value : {};
    const id = this.toNonNegativeInteger(record.id, "Despacho de transferencia invalido.");
    return {
      id,
      descripcion: String(record.descripcion || `SYNC_DESPACHO_${id}`).trim(),
      estado: record.estado === null || record.estado === undefined ? 1 : Number(record.estado),
    };
  }

  private async prepareSyncedDestinationInventory(
    tx: TransferTransactionClient,
    payload: TransferSyncPayload,
  ) {
    const now = new Date();
    const correctionTransfer = payload.transfer.correccion;

    for (const line of payload.items) {
      const article = line.articulo;
      await this.ensureSyncedInventoryCatalogs(tx, article);

      const existingArticle = await tx.inventario.findUnique({
        where: { CodigoBarra: article.codigoBarra },
      });

      if (existingArticle) {
        if (correctionTransfer) {
          continue;
        }

        await this.ensureUniqueTransferReferencePerBrand(
          tx,
          article.referencia,
          article.codigoMarca,
          existingArticle.CodigoBarra,
        );

        await tx.inventario.update({
          where: { CodigoBarra: existingArticle.CodigoBarra },
          data: {
            ...this.buildSyncedInventoryAttributeUpdate(article),
            UltimaActualizacion: now,
          },
        });

        continue;
      }

      await this.ensureUniqueTransferReferencePerBrand(
        tx,
        article.referencia,
        article.codigoMarca,
        article.codigoBarra,
      );

      await tx.inventario.create({
        data: this.buildSyncedInventoryCreateInput(article, ZERO, now),
      });
    }
  }

  private async applySyncedDestinationReceipt(
    tx: TransferTransactionClient,
    payload: TransferSyncPayload,
  ) {
    const now = new Date();

    for (const line of payload.items) {
      const article = line.articulo;
      const quantity = this.parsePositiveDecimal(line.cantidad, "Cantidad de transferencia invalida.");

      await this.ensureSyncedInventoryCatalogs(tx, article);

      const existingArticle = await tx.inventario.findUnique({
        where: { CodigoBarra: article.codigoBarra },
      });

      if (existingArticle) {
        await this.ensureUniqueTransferReferencePerBrand(
          tx,
          article.referencia,
          article.codigoMarca,
          existingArticle.CodigoBarra,
        );

        await tx.inventario.update({
          where: { CodigoBarra: existingArticle.CodigoBarra },
          data: {
            ...this.buildSyncedInventoryAttributeUpdate(article),
            Existencia: existingArticle.Existencia.plus(quantity),
            UltimaActualizacion: now,
            FechaPrimerMovimiento: existingArticle.FechaPrimerMovimiento ?? now,
          },
        });

        continue;
      }

      await this.ensureUniqueTransferReferencePerBrand(
        tx,
        article.referencia,
        article.codigoMarca,
        article.codigoBarra,
      );

      await tx.inventario.create({
        data: this.buildSyncedInventoryCreateInput(article, quantity, now),
      });
    }
  }

  private async recordSyncedInboundTransfer(
    tx: TransferTransactionClient,
    payload: TransferSyncPayload,
  ) {
    await tx.iTransferencias.create({
      data: {
        Numero: payload.transfer.numero,
        CodigoEnvia: payload.transfer.codigoEnvia,
        CodigoRecibe: payload.transfer.codigoRecibe,
        Fecha: new Date(payload.transfer.fecha),
        FechaEmision: new Date(payload.transfer.fechaEmision),
        TotalValor: this.parseNonNegativeDecimal(payload.transfer.totalValor, "Total de transferencia invalido."),
        Observacion: payload.transfer.observacion,
        Status: 1,
        Usuario: payload.transfer.usuario,
        InterContable: payload.transfer.interContable,
        IDLote: payload.transfer.idLote,
        IDDespacho: payload.transfer.idDespacho,
        Correccion: payload.transfer.correccion,
      },
    });

    await tx.iMovTransferencias.createMany({
      data: payload.items.map((line) => ({
        Numero: payload.transfer.numero,
        CodigoEnvia: payload.transfer.codigoEnvia,
        Item: line.item,
        Fecha: line.fecha ? new Date(line.fecha) : null,
        CodigoBarra: line.articulo.codigoBarra,
        Cantidad: this.parsePositiveDecimal(line.cantidad, "Cantidad de transferencia invalida."),
        Valor: this.parseNonNegativeDecimal(line.valor, "Valor de transferencia invalido."),
        NumeroCaja: line.numeroCaja,
        UltimoCosto: line.ultimoCosto === null
          ? null
          : this.parseNonNegativeDecimal(line.ultimoCosto, "Ultimo costo de transferencia invalido."),
        CostoInicial: line.costoInicial === null
          ? null
          : this.parseNonNegativeDecimal(line.costoInicial, "Costo inicial de transferencia invalido."),
        CostoDolar: line.costoDolar === null
          ? null
          : this.parseNonNegativeDecimal(line.costoDolar, "Costo dolar de transferencia invalido."),
      })),
    });
  }

  private async ensureSyncedInventoryCatalogs(
    tx: TransferTransactionClient,
    article: TransferSyncInventoryPayload,
  ) {
    await tx.marcas.upsert({
      where: { Codigo: article.codigoMarca },
      update: {
        Nombre: this.catalogName(article.catalogs.marca, article.codigoMarca),
        Status: this.catalogStatus(article.catalogs.marca),
      },
      create: {
        Codigo: article.codigoMarca,
        Nombre: this.catalogName(article.catalogs.marca, article.codigoMarca),
        Status: this.catalogStatus(article.catalogs.marca),
      },
    });

    await tx.tallas.upsert({
      where: { Codigo: article.talla },
      update: {},
      create: { Codigo: article.talla },
    });

    await tx.colores.upsert({
      where: { Codigo: article.codigoColor },
      update: {
        Nombre: this.catalogName(article.catalogs.color, article.codigoColor),
        Status: this.catalogStatus(article.catalogs.color),
      },
      create: {
        Codigo: article.codigoColor,
        Nombre: this.catalogName(article.catalogs.color, article.codigoColor),
        Status: this.catalogStatus(article.catalogs.color),
      },
    });

    await tx.fabricantes.upsert({
      where: { Codigo: article.fabricante },
      update: {
        Nombre: this.catalogName(article.catalogs.fabricante, article.fabricante),
        Status: this.catalogStatus(article.catalogs.fabricante),
      },
      create: {
        Codigo: article.fabricante,
        Nombre: this.catalogName(article.catalogs.fabricante, article.fabricante),
        Status: this.catalogStatus(article.catalogs.fabricante),
      },
    });

    await tx.categorias.upsert({
      where: { Codigo: article.categoria },
      update: {
        Nombre: this.catalogName(article.catalogs.categoria, article.categoria),
        Status: this.catalogStatus(article.catalogs.categoria),
      },
      create: {
        Codigo: article.categoria,
        Nombre: this.catalogName(article.catalogs.categoria, article.categoria),
        Status: this.catalogStatus(article.catalogs.categoria),
      },
    });

    await tx.impuestos.upsert({
      where: { Codigo: article.tipoImpuesto },
      update: {
        Nombre: this.catalogName(article.catalogs.impuesto, `IVA ${article.tipoImpuesto}`),
        PorcentajeImpuesto: article.catalogs.impuesto.porcentajeImpuesto
          ? this.parseNonNegativeDecimal(article.catalogs.impuesto.porcentajeImpuesto, "Porcentaje de impuesto invalido.")
          : undefined,
      },
      create: {
        Codigo: article.tipoImpuesto,
        Nombre: this.catalogName(article.catalogs.impuesto, `IVA ${article.tipoImpuesto}`),
        PorcentajeImpuesto: article.catalogs.impuesto.porcentajeImpuesto
          ? this.parseNonNegativeDecimal(article.catalogs.impuesto.porcentajeImpuesto, "Porcentaje de impuesto invalido.")
          : ZERO,
      },
    });
  }

  private async ensureSyncedDispatchType(
    tx: TransferTransactionClient,
    payload: TransferSyncPayload,
  ) {
    const existing = await tx.tipoDespacho.findUnique({
      where: { ID: payload.transfer.idDespacho },
    });

    if (existing) {
      return;
    }

    await tx.tipoDespacho.create({
      data: {
        ID: payload.transfer.idDespacho,
        Descripcion: payload.transfer.tipoDespacho.descripcion || `SYNC_DESPACHO_${payload.transfer.idDespacho}`,
        Estado: payload.transfer.tipoDespacho.estado,
      },
    });
  }

  private async ensureSyncedLot(
    tx: TransferTransactionClient,
    payload: TransferSyncPayload,
  ) {
    const existing = await tx.lotes.findUnique({
      where: { ID: payload.transfer.idLote },
    });

    if (existing) {
      return;
    }

    await tx.lotes.create({
      data: {
        ID: payload.transfer.idLote,
        Lote: payload.transfer.lote.lote || `SYNC_LOTE_${payload.transfer.idLote}`,
        Descripcion: payload.transfer.lote.descripcion,
        Estado: payload.transfer.lote.estado,
        FechaRegistro: new Date(),
        UsuarioCreacion: payload.transfer.usuario || "sistema",
      },
    });
  }

  private buildSyncedInventoryCreateInput(
    article: TransferSyncInventoryPayload,
    quantity: Prisma.Decimal,
    now: Date,
  ): Prisma.InventarioUncheckedCreateInput {
    return {
      ...this.buildSyncedInventoryAttributes(article),
      CodigoBarra: article.codigoBarra,
      ExistenciaInicial: quantity,
      Existencia: quantity,
      FechaPrimerMovimiento: now,
      UltimaActualizacion: now,
    };
  }

  private buildSyncedInventoryAttributeUpdate(
    article: TransferSyncInventoryPayload,
  ): Prisma.InventarioUncheckedUpdateInput {
    return this.buildSyncedInventoryAttributes(article);
  }

  private buildSyncedInventoryAttributes(article: TransferSyncInventoryPayload) {
    return {
      Referencia: article.referencia,
      CodigoMarca: article.codigoMarca,
      Nombre: article.nombre,
      Talla: article.talla,
      CodigoColor: article.codigoColor,
      Fabricante: article.fabricante,
      Categoria: article.categoria,
      Nota: article.nota,
      TipoImpuesto: article.tipoImpuesto,
      PrecioDetal: this.parseNonNegativeDecimal(article.precioDetal, "Precio detal invalido."),
      PrecioMayor: this.parseNonNegativeDecimal(article.precioMayor, "Precio mayor invalido."),
      PrecioAfiliado: this.parseNonNegativeDecimal(article.precioAfiliado, "Precio afiliado invalido."),
      PrecioPromocion: this.parseNonNegativeDecimal(article.precioPromocion, "Precio promocion invalido."),
      Promocion: article.promocion,
      FechaInicial: new Date(article.fechaInicial),
      FechaFinal: new Date(article.fechaFinal),
      CostoInicial: this.parseNonNegativeDecimal(article.costoInicial, "Costo inicial invalido."),
      CostoPromedio: this.parseNonNegativeDecimal(article.costoPromedio, "Costo promedio invalido."),
      UltimoCosto: this.parseNonNegativeDecimal(article.ultimoCosto, "Ultimo costo invalido."),
      CostoDolar: this.parseNonNegativeDecimal(article.costoDolar, "Costo dolar invalido."),
      PuntoReorden: this.parseNonNegativeDecimal(article.puntoReorden, "Punto de reorden invalido."),
      Tipo: article.tipo,
      Status: article.status,
      Serializado: article.serializado,
      CodigoBarraAnt: article.codigoBarraAnt,
    };
  }

  private async upsertTransferSyncInbox(
    tx: TransferTransactionClient,
    payload: TransferSyncPayload,
    status: string,
  ) {
    await tx.$executeRawUnsafe(
      `
        insert into dbo."TRANSFER_SYNC_INBOX"
          (
            "GlobalId",
            "NumeroOrigen",
            "CodigoEnvia",
            "CodigoRecibe",
            "SourceNodeId",
            "DestinationNodeId",
            "EventType",
            "Payload",
            "Status",
            "ReceivedAt",
            "AppliedAt",
            "Attempts",
            "LastError"
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), null, 0, null)
        on conflict ("GlobalId") do update set
          "Payload" = excluded."Payload",
          "Status" = excluded."Status",
          "LastError" = null
      `,
      payload.globalId,
      payload.transfer.numero,
      payload.transfer.codigoEnvia,
      payload.transfer.codigoRecibe,
      payload.sourceNodeId,
      payload.destinationNodeId,
      payload.eventType,
      JSON.stringify(payload),
      status,
    );
  }

  private async markTransferSyncInboxApplied(tx: TransferTransactionClient, globalId: string) {
    await tx.$executeRawUnsafe(
      `
        update dbo."TRANSFER_SYNC_INBOX"
        set
          "Status" = $2,
          "AppliedAt" = now(),
          "LastError" = null
        where "GlobalId" = $1
      `,
      globalId,
      TRANSFER_SYNC_STATUS_APPLIED,
    );
  }

  private async markTransferSyncInboxError(payload: TransferSyncPayload, message: string) {
    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."TRANSFER_SYNC_INBOX"
          (
            "GlobalId",
            "NumeroOrigen",
            "CodigoEnvia",
            "CodigoRecibe",
            "SourceNodeId",
            "DestinationNodeId",
            "EventType",
            "Payload",
            "Status",
            "ReceivedAt",
            "AppliedAt",
            "Attempts",
            "LastError"
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), null, 1, $10)
        on conflict ("GlobalId") do update set
          "Status" = excluded."Status",
          "Attempts" = dbo."TRANSFER_SYNC_INBOX"."Attempts" + 1,
          "LastError" = excluded."LastError"
      `,
      payload.globalId,
      payload.transfer.numero,
      payload.transfer.codigoEnvia,
      payload.transfer.codigoRecibe,
      payload.sourceNodeId,
      payload.destinationNodeId,
      payload.eventType,
      JSON.stringify(payload),
      TRANSFER_SYNC_STATUS_ERROR,
      message,
    );
  }

  private async getTransferSyncInboxRow(
    tx: TransferTransactionClient,
    globalId: string,
  ) {
    const rows = await tx.$queryRawUnsafe<TransferSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_INBOX"
        where "GlobalId" = $1
        limit 1
      `,
      globalId,
    );

    return rows[0] ?? null;
  }

  private async getTransferSyncInboxRowForTransfer(
    tx: PrismaService | TransferTransactionClient,
    numero: number,
    codigoEnvia: string,
    codigoRecibe: string,
  ) {
    const rows = await tx.$queryRawUnsafe<TransferSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_INBOX"
        where "NumeroOrigen" = $1
          and upper("CodigoEnvia") = upper($2)
          and upper("CodigoRecibe") = upper($3)
        order by "ReceivedAt" desc
        limit 1
      `,
      numero,
      codigoEnvia,
      codigoRecibe,
    );

    return rows[0] ?? null;
  }

  private async resolveTransferSyncNodeId(
    client: PrismaService | TransferTransactionClient,
    sucursalCodigo: string,
  ) {
    const code = this.normalizeRequiredCode(sucursalCodigo, "Codigo de sucursal invalido.");
    const rows = await client.$queryRawUnsafe<TransferSyncNodeRow[]>(
      `
        select
          "NodeId",
          "SucursalCodigo",
          "Nombre",
          "Tipo",
          "ApiUrl",
          "CreatedAt",
          "UpdatedAt",
          "LastSeenAt"
        from dbo."SYNC_NODES"
        where upper("SucursalCodigo") = upper($1) or upper("NodeId") = upper($1)
        order by case when upper("SucursalCodigo") = upper($1) then 0 else 1 end
        limit 1
      `,
      code,
    );

    return rows[0]?.NodeId ?? code;
  }

  private async getTransferSyncNodeById(nodeId: string) {
    const rows = await this.prisma.$queryRawUnsafe<TransferSyncNodeRow[]>(
      `
        select
          "NodeId",
          "SucursalCodigo",
          "Nombre",
          "Tipo",
          "ApiUrl",
          "CreatedAt",
          "UpdatedAt",
          "LastSeenAt"
        from dbo."SYNC_NODES"
        where "NodeId" = $1
        limit 1
      `,
      nodeId,
    );

    if (!rows[0]) {
      throw new NotFoundException("El nodo de sincronizacion no existe.");
    }

    return this.toTransferSyncNodeView(rows[0]);
  }

  private toTransferSyncNodeView(row: TransferSyncNodeRow) {
    return {
      nodeId: row.NodeId,
      sucursalCodigo: row.SucursalCodigo,
      nombre: row.Nombre,
      tipo: row.Tipo,
      apiUrl: row.ApiUrl,
      creado: row.CreatedAt,
      actualizado: row.UpdatedAt,
      ultimaConexion: row.LastSeenAt,
    };
  }

  private toTransferSyncOutboxView(row: TransferSyncOutboxRow) {
    return {
      globalId: row.GlobalId,
      numero: row.Numero,
      codigoEnvia: row.CodigoEnvia,
      codigoRecibe: row.CodigoRecibe,
      sourceNodeId: row.SourceNodeId,
      destinationNodeId: row.DestinationNodeId,
      eventType: row.EventType,
      payload: this.parseRawJson(row.Payload),
      status: row.Status,
      creado: row.CreatedAt,
      enviado: row.SentAt,
      intentos: row.Attempts,
      ultimoError: row.LastError,
    };
  }

  private buildTransferGlobalId(sourceNodeId: string, numero: number) {
    return `${this.normalizeSyncNodeId(sourceNodeId)}-TRF-${String(numero).padStart(10, "0")}`;
  }

  private normalizeGlobalTransferId(value: unknown) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Identificador global de transferencia invalido.");
    }

    return normalized;
  }

  private normalizeSyncNodeId(value: unknown) {
    const normalized = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new BadRequestException("Identificador de nodo invalido.");
    }

    return normalized;
  }

  private normalizeOptionalApiUrl(value: unknown) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return null;
    }

    return this.normalizeRequiredApiUrl(normalized);
  }

  private normalizeRequiredApiUrl(value: unknown) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException("La URL del nodo debe comenzar con http:// o https://.");
    }

    return normalized;
  }

  private catalogName(catalog: TransferSyncCatalogPayload, fallback: string | number) {
    return String(catalog.nombre || fallback || "").trim();
  }

  private catalogStatus(catalog: TransferSyncCatalogPayload) {
    return typeof catalog.status === "number" && Number.isFinite(catalog.status) ? catalog.status : 1;
  }

  private toIsoString(value: Date) {
    return value.toISOString();
  }

  private toRequiredIsoString(value: unknown, message: string) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(message);
    }

    return date.toISOString();
  }

  private toPositiveInteger(value: unknown, message: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private toNonNegativeInteger(value: unknown, message: string) {
    const parsed = Number(value ?? 0);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private parseRawJson(value: unknown) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private extractSyncErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return "Error desconocido al sincronizar la transferencia.";
  }

  private async normalizeTransferDraft(
    tx: TransferTransactionClient,
    input: CreateTransferDto | UpdateTransferDto,
    options?: {
      fechaFallback?: Date;
      fechaEmisionFallback?: Date;
      documentoOrigenFallback?: string;
      observacionFallback?: string;
      interContableFallback?: number;
      idDespachoFallback?: number;
      correccionFallback?: boolean;
      zonaFallback?: string;
    },
  ): Promise<NormalizedTransferDraft> {
    const fecha = input.fecha ?? options?.fechaFallback ?? new Date();
    const fechaEmision = input.fechaEmision ?? options?.fechaEmisionFallback ?? fecha;
    const codigoEnvia = this.normalizeOptionalCode(input.codigoEnvia) || DEFAULT_ORIGIN_CODE;
    const codigoRecibe = this.normalizeOptionalCode(input.codigoRecibe) || DEFAULT_DESTINATION_CODE;

    if (codigoEnvia === codigoRecibe) {
      throw new BadRequestException("El origen y el destino no pueden ser iguales.");
    }

    const lines = await this.normalizeTransferLines(
      tx,
      input.items,
      fecha,
      Boolean(input.correccion ?? options?.correccionFallback ?? false),
    );

    const quantitiesByBarcode = this.aggregateLineQuantities(lines);
    const totalValor = lines.reduce((total, line) => total.plus(line.valor.mul(line.cantidad)), ZERO);

    return {
      fecha,
      fechaEmision,
      codigoEnvia,
      codigoRecibe,
      documentoOrigen: String(input.documentoOrigen ?? options?.documentoOrigenFallback ?? "").trim(),
      observacion: String(input.observacion ?? options?.observacionFallback ?? "").trim(),
      interContable: input.interContable ?? options?.interContableFallback ?? 0,
      idDespacho: input.idDespacho ?? options?.idDespachoFallback ?? DEFAULT_DISPATCH_ID,
      correccion: input.correccion ?? options?.correccionFallback ?? false,
      zona: String(input.zona ?? options?.zonaFallback ?? "").trim(),
      lines,
      totalValor,
      quantitiesByBarcode,
    };
  }

  private async normalizeTransferLines(
    tx: TransferTransactionClient,
    items: CreateTransferLineDto[] | undefined,
    fecha: Date,
    correctionTransfer = false,
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const meaningfulItems = items.filter((item) => Boolean(String(item.codigoBarra || "").trim()));

    if (meaningfulItems.length === 0) {
      return [];
    }

    const normalizedCodes = meaningfulItems.map((item) => this.normalizeRequiredCode(item.codigoBarra, "Codigo de barra invalido."));
    const normalizedReferences = meaningfulItems.map((item) => this.normalizeOptionalCode(item.referencia));
    const uniqueCodes = Array.from(new Set(normalizedCodes));

    const inventoryItems = await tx.inventario.findMany({
      where: {
        CodigoBarra: { in: uniqueCodes },
      },
    });

    if (inventoryItems.length !== uniqueCodes.length) {
      const foundCodes = new Set(inventoryItems.map((item) => item.CodigoBarra));
      const missingCodes = uniqueCodes.filter((code) => !foundCodes.has(code));
      throw new NotFoundException(
        `No se encontraron articulos en inventario para: ${missingCodes.join(", ")}.`,
      );
    }

    const inventoryByCode = new Map(inventoryItems.map((item) => [item.CodigoBarra, item]));

    const lines = meaningfulItems.map((item, index) => {
      const codigoBarra = normalizedCodes[index];
      const referencia = normalizedReferences[index] || "";
      const articulo = inventoryByCode.get(codigoBarra);
      if (!articulo) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} en inventario.`);
      }

      const resolvedReferencia = referencia || String(articulo.Referencia || "").trim().toUpperCase();
      if (!correctionTransfer && String(articulo.Referencia || "").trim().toUpperCase() !== resolvedReferencia) {
        throw new BadRequestException(
          `El articulo ${codigoBarra} no coincide con la referencia ${resolvedReferencia} en inventario.`,
        );
      }

      const cantidad = this.parsePositiveDecimal(
        item.cantidad || "1",
        `La cantidad del articulo ${codigoBarra} debe ser mayor a cero.`,
      );
      const valor = item.valor
        ? this.parseNonNegativeDecimal(item.valor, `El valor del articulo ${codigoBarra} no es valido.`)
        : this.resolveLineValue(articulo);

      return {
        item: index + 1,
        fecha,
        codigoBarra,
        referencia: resolvedReferencia,
        cantidad,
        valor,
        numeroCaja: item.numeroCaja ?? 0,
        ultimoCosto: articulo.UltimoCosto,
        costoInicial: articulo.CostoInicial,
        costoDolar: articulo.CostoDolar,
        articulo,
      };
    });

    const referencesByBarcode = new Map<string, string>();
    for (const line of lines) {
      const existingReference = referencesByBarcode.get(line.codigoBarra);
      if (existingReference && existingReference !== line.referencia) {
        throw new BadRequestException(
          `No puedes usar referencias distintas para el articulo ${line.codigoBarra} dentro de la misma transferencia.`,
        );
      }

      referencesByBarcode.set(line.codigoBarra, line.referencia);
    }

    return lines;
  }

  private async findTransferDetailOrThrow(
    client: PrismaService | TransferTransactionClient,
    numero: number,
  ) {
    const transferencia = await client.transferencias.findUnique({
      where: { Numero: numero },
      include: transferInclude,
    });

    if (!transferencia) {
      throw new NotFoundException("La transferencia no existe.");
    }

    const originLocations = await this.loadLocationsByCode([transferencia.CodigoEnvia], client);
    const correctionReferences = await this.getTransferCorrectionReferenceMap(client, numero);
    const detail = toTransferDetailView(transferencia, {
      codigoEnviaInfo: this.toLocationView(originLocations.get(transferencia.CodigoEnvia)),
    });

    return this.applyTransferCorrectionReferencesToDetail(detail, correctionReferences);
  }

  private async findInboundTransferDetailOrThrow(
    numero: number,
    client: PrismaService | TransferTransactionClient = this.prisma,
  ) {
    const transferencia = await client.iTransferencias.findFirst({
      where: { Numero: numero },
      include: {
        sucursalEnvia: true,
        tipoDespacho: true,
        iMovTransferencias: {
          orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
          include: {
            inventarioRef: {
              select: {
                CodigoBarra: true,
                Nombre: true,
                Referencia: true,
                Existencia: true,
              },
            },
          },
        },
      },
    });

    if (!transferencia) {
      throw new NotFoundException("La transferencia recibida no existe.");
    }

    const [destinationLocations, syncRow] = await Promise.all([
      this.loadLocationsByCode([transferencia.CodigoRecibe], client),
      this.getTransferSyncInboxRowForTransfer(
        client,
        transferencia.Numero,
        transferencia.CodigoEnvia,
        transferencia.CodigoRecibe,
      ),
    ]);

    const detail = this.toInboundTransferDetailView(transferencia, {
      codigoRecibeInfo: this.toLocationView(destinationLocations.get(transferencia.CodigoRecibe)),
      syncRow,
    });

    const payload = syncRow
      ? this.tryNormalizeTransferSyncPayloadFromRaw(syncRow.Payload)
      : null;

    return this.applyTransferCorrectionReferencesToDetail(
      detail,
      payload ? this.buildTransferCorrectionReferenceMapFromPayload(payload) : new Map<string, string>(),
    );
  }

  private async loadInboundSyncRows(
    transfers: Array<Pick<InboundTransferWithRelations, "Numero" | "CodigoEnvia" | "CodigoRecibe">>,
    client: PrismaService | TransferTransactionClient = this.prisma,
  ) {
    const numeros = Array.from(new Set(transfers.map((item) => item.Numero)));
    if (numeros.length === 0) {
      return new Map<string, TransferSyncInboxRow>();
    }

    const rows = await client.$queryRawUnsafe<TransferSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_INBOX"
        where "NumeroOrigen" = any($1::integer[])
        order by "ReceivedAt" desc
      `,
      numeros,
    );

    const rowsByKey = new Map<string, TransferSyncInboxRow>();
    for (const row of rows) {
      const key = this.buildInboundSyncKey(row.NumeroOrigen, row.CodigoEnvia, row.CodigoRecibe);
      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, row);
      }
    }

    return rowsByKey;
  }

  private buildInboundSyncKey(numero: number, codigoEnvia: string, codigoRecibe: string) {
    return [
      String(numero),
      String(codigoEnvia || "").trim().toUpperCase(),
      String(codigoRecibe || "").trim().toUpperCase(),
    ].join("|");
  }

  private buildSearchWhere(findTransfersDto: FindTransfersDto): Prisma.TransferenciasWhereInput {
    const search = String(findTransfersDto.buscar || "").trim();
    const conditions: Prisma.TransferenciasWhereInput[] = [];

    if (typeof findTransfersDto.status === "number") {
      conditions.push({ Status: findTransfersDto.status });
    }

    if (search) {
      const numericSearch = Number.parseInt(search, 10);
      conditions.push({
        OR: [
          Number.isInteger(numericSearch) ? { Numero: numericSearch } : undefined,
          { CodigoEnvia: { contains: search, mode: "insensitive" } },
          { CodigoRecibe: { contains: search, mode: "insensitive" } },
          { DocumentoOrigen: { contains: search, mode: "insensitive" } },
          { Observacion: { contains: search, mode: "insensitive" } },
          { Usuario: { contains: search, mode: "insensitive" } },
        ].filter(Boolean) as Prisma.TransferenciasWhereInput[],
      });
    }

    if (conditions.length === 0) {
      return {};
    }

    return {
      AND: conditions,
    };
  }

  private buildInboundSearchWhere(findTransfersDto: FindTransfersDto): Prisma.ITransferenciasWhereInput {
    const search = String(findTransfersDto.buscar || "").trim();
    const conditions: Prisma.ITransferenciasWhereInput[] = [];

    if (typeof findTransfersDto.status === "number") {
      conditions.push({ Status: findTransfersDto.status });
    }

    if (search) {
      const numericSearch = Number.parseInt(search, 10);
      conditions.push({
        OR: [
          Number.isInteger(numericSearch) ? { Numero: numericSearch } : undefined,
          { CodigoEnvia: { contains: search, mode: "insensitive" } },
          { CodigoRecibe: { contains: search, mode: "insensitive" } },
          { Observacion: { contains: search, mode: "insensitive" } },
          { Usuario: { contains: search, mode: "insensitive" } },
        ].filter(Boolean) as Prisma.ITransferenciasWhereInput[],
      });
    }

    if (conditions.length === 0) {
      return {};
    }

    return {
      AND: conditions,
    };
  }

  private toInboundTransferListItemView(
    item: InboundTransferWithRelations,
    options: {
      codigoRecibeInfo?: {
        codigo: string;
        nombre: string | null;
        status: number | null;
      } | null;
      syncRow?: TransferSyncInboxRow | null;
    } = {},
  ) {
    const syncStatus = options.syncRow?.Status ?? null;
    const cargada = syncStatus === TRANSFER_SYNC_STATUS_APPLIED;
    const fechaAprobacion = item.FechaEmision;

    return {
      numero: item.Numero,
      fecha: item.Fecha,
      fechaRegistro: item.Fecha,
      fechaAprobacion,
      codigoEnvia: item.CodigoEnvia,
      codigoRecibe: item.CodigoRecibe,
      codigoEnviaInfo: {
        codigo: item.sucursalEnvia.Codigo,
        nombre: item.sucursalEnvia.Nombre,
        status: item.sucursalEnvia.Status,
      },
      codigoRecibeInfo: options.codigoRecibeInfo,
      documentoOrigen: "",
      totalValor: item.TotalValor.toString(),
      observacion: item.Observacion,
      status: item.Status,
      statusNombre: item.Status === 1 ? "aprobada" : `status-${item.Status}`,
      usuario: item.Usuario,
      fechaEmision: fechaAprobacion,
      editable: false,
      totalItems: item.iMovTransferencias.length,
      inbound: true,
      syncStatus,
      cargada,
      fechaCarga: options.syncRow?.AppliedAt ?? null,
    };
  }

  private toInboundTransferDetailView(
    item: InboundTransferWithRelations,
    options: {
      codigoRecibeInfo?: {
        codigo: string;
        nombre: string | null;
        status: number | null;
      } | null;
      syncRow?: TransferSyncInboxRow | null;
    } = {},
  ) {
    const fechaAprobacion = item.FechaEmision;

    return {
      ...this.toInboundTransferListItemView(item, options),
      fechaEmision: fechaAprobacion,
      fechaAprobacion,
      interContable: item.InterContable,
      idLote: item.IDLote,
      idDespacho: item.IDDespacho,
      correccion: item.Correccion,
      zona: "",
      tipoDespacho: {
        id: item.tipoDespacho.ID,
        descripcion: item.tipoDespacho.Descripcion,
        estado: item.tipoDespacho.Estado,
      },
      items: item.iMovTransferencias.map((line) => ({
        item: line.Item,
        fecha: line.Fecha,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
        numeroCaja: line.NumeroCaja,
        ultimoCosto: line.UltimoCosto?.toString() ?? null,
        costoInicial: line.CostoInicial?.toString() ?? null,
        costoDolar: line.CostoDolar?.toString() ?? null,
        articulo: {
          codigoBarra: line.inventarioRef.CodigoBarra,
          nombre: line.inventarioRef.Nombre,
          referencia: line.inventarioRef.Referencia,
          existenciaActual: line.inventarioRef.Existencia.toString(),
        },
      })),
    };
  }

  private async getNextTransferNumber(tx: TransferTransactionClient) {
    const result = await tx.transferencias.aggregate({
      _max: {
        Numero: true,
      },
    });

    return (result._max.Numero ?? 0) + 1;
  }

  private async resolveTransferLoteId(
    tx: TransferTransactionClient,
    requestedId: number | undefined,
    userCode: string,
  ) {
    if (typeof requestedId === "number") {
      const lot = await tx.lotes.findUnique({
        where: { ID: requestedId },
      });

      if (!lot) {
        throw new BadRequestException("El lote indicado no existe.");
      }

      return lot.ID;
    }

    const existing = await tx.lotes.findUnique({
      where: { Lote: DEFAULT_TRANSFER_LOT },
    });

    if (existing) {
      return existing.ID;
    }

    const nextLotId = await this.getNextLotId(tx);

    try {
      const created = await tx.lotes.create({
        data: {
          ID: nextLotId,
          Lote: DEFAULT_TRANSFER_LOT,
          Descripcion: DEFAULT_TRANSFER_LOT_DESCRIPTION,
          Estado: 1,
          FechaRegistro: new Date(),
          UsuarioCreacion: userCode,
        },
      });

      return created.ID;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        const lot = await tx.lotes.findUnique({
          where: { Lote: DEFAULT_TRANSFER_LOT },
        });

        if (lot) {
          return lot.ID;
        }
      }

      throw error;
    }
  }

  private async getNextLotId(tx: TransferTransactionClient) {
    const result = await tx.lotes.aggregate({
      _max: {
        ID: true,
      },
    });

    return (result._max.ID ?? 0) + 1;
  }

  private async ensureLocations(client: PrismaService | TransferTransactionClient, codes: string[]) {
    const normalizedCodes = Array.from(
      new Set(
        codes
          .map((code) => String(code || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    if (normalizedCodes.length === 0) {
      return;
    }

    const existing = await client.sucursales.findMany({
      where: {
        Codigo: { in: normalizedCodes },
      },
    });

    const existingCodes = new Set(existing.map((item) => item.Codigo));

    for (const code of normalizedCodes) {
      if (existingCodes.has(code)) {
        continue;
      }

      await client.sucursales.create({
        data: {
          Codigo: code,
          Nombre: code,
          Direccion: "",
          Telefono: "",
          Status: 1,
          PorcentajeDeRedondeo: ZERO,
        },
      });
    }
  }

  private async ensureDispatchTypeExists(tx: TransferTransactionClient, idDespacho: number) {
    const dispatch = await tx.tipoDespacho.findUnique({
      where: { ID: idDespacho },
    });

    if (!dispatch) {
      throw new BadRequestException("El tipo de despacho indicado no existe.");
    }
  }

  private aggregateSavedQuantities(lines: Array<{ CodigoBarra: string; Cantidad: Prisma.Decimal }>) {
    const quantities = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      const current = quantities.get(line.CodigoBarra) ?? ZERO;
      quantities.set(line.CodigoBarra, current.plus(line.Cantidad));
    }

    return quantities;
  }

  private aggregateLineQuantities(lines: NormalizedTransferLine[]) {
    const quantities = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      const current = quantities.get(line.codigoBarra) ?? ZERO;
      quantities.set(line.codigoBarra, current.plus(line.cantidad));
    }

    return quantities;
  }

  private subtractAggregateMaps(
    current: Map<string, Prisma.Decimal>,
    previous: Map<string, Prisma.Decimal>,
  ) {
    const result = new Map<string, Prisma.Decimal>();
    const keys = new Set([...current.keys(), ...previous.keys()]);

    for (const key of keys) {
      const nextValue = current.get(key) ?? ZERO;
      const previousValue = previous.get(key) ?? ZERO;
      const delta = nextValue.minus(previousValue);

      if (!delta.isZero()) {
        result.set(key, delta);
      }
    }

    return result;
  }

  private negateAggregateMap(values: Map<string, Prisma.Decimal>) {
    const result = new Map<string, Prisma.Decimal>();

    for (const [key, value] of values.entries()) {
      if (!value.isZero()) {
        result.set(key, value.negated());
      }
    }

    return result;
  }

  private async syncTransferCorrectionItems(
    tx: TransferTransactionClient,
    numero: number,
    lines: NormalizedTransferLine[],
    correctionTransfer: boolean,
  ) {
    await this.ensureTransferCorrectionSchema(tx);

    await tx.$executeRawUnsafe(
      `
        delete from dbo."TRANSFER_CORRECTION_ITEMS"
        where "Numero" = $1
      `,
      numero,
    );

    if (!correctionTransfer || lines.length === 0) {
      return;
    }

    for (const line of lines) {
      await tx.$executeRawUnsafe(
        `
          insert into dbo."TRANSFER_CORRECTION_ITEMS"
            ("Numero", "Item", "NumeroCaja", "CodigoBarra", "Referencia", "CreatedAt", "UpdatedAt")
          values ($1, $2, $3, $4, $5, now(), now())
          on conflict ("Numero", "Item", "NumeroCaja", "CodigoBarra") do update set
            "Referencia" = excluded."Referencia",
            "UpdatedAt" = now()
        `,
        numero,
        line.item,
        line.numeroCaja,
        line.codigoBarra,
        line.referencia,
      );
    }
  }

  private async getTransferCorrectionReferenceMap(
    client: PrismaService | TransferTransactionClient,
    numero: number,
  ) {
    await this.ensureTransferCorrectionSchema(client);

    const rows = await client.$queryRawUnsafe<TransferCorrectionItemRow[]>(
      `
        select
          "Numero",
          "Item",
          "NumeroCaja",
          "CodigoBarra",
          "Referencia",
          "CreatedAt",
          "UpdatedAt"
        from dbo."TRANSFER_CORRECTION_ITEMS"
        where "Numero" = $1
      `,
      numero,
    );

    return new Map(
      rows.map((row) => [
        this.buildTransferCorrectionLineKey(row.Item, row.NumeroCaja, row.CodigoBarra),
        row.Referencia,
      ]),
    );
  }

  private buildTransferCorrectionLineKey(item: number, numeroCaja: number, codigoBarra: string) {
    return [String(item), String(numeroCaja), String(codigoBarra || "").trim().toUpperCase()].join("|");
  }

  private applyTransferCorrectionReferencesToDetail<T extends { items?: Array<Record<string, unknown>> }>(
    detail: T,
    correctionReferences: Map<string, string>,
  ) {
    if (!detail?.items?.length || correctionReferences.size === 0) {
      return detail;
    }

    return {
      ...detail,
      items: detail.items.map((line) => {
        const correctionReference = correctionReferences.get(
          this.buildTransferCorrectionLineKey(
            Number(line.item || 0),
            Number(line.numeroCaja || 0),
            String(line.codigoBarra || ""),
          ),
        );

        if (!correctionReference) {
          return line;
        }

        const articulo = this.isRecord(line.articulo)
          ? {
              ...line.articulo,
              referencia: correctionReference,
            }
          : line.articulo;

        return {
          ...line,
          referencia: correctionReference,
          articulo,
        };
      }),
    };
  }

  private buildTransferCorrectionReferenceMapFromPayload(payload: TransferSyncPayload) {
    return new Map(
      payload.items.map((line) => [
        this.buildTransferCorrectionLineKey(line.item, line.numeroCaja, line.codigoBarra),
        line.articulo.referencia,
      ]),
    );
  }

  private tryNormalizeTransferSyncPayloadFromRaw(rawPayload: unknown) {
    try {
      return this.normalizeTransferSyncPayload(this.parseRawJson(rawPayload) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private async applyTransferCorrectionOverridesToOrigin(
    tx: TransferTransactionClient,
    numero: number,
    correctionTransfer: boolean,
  ) {
    if (!correctionTransfer) {
      return 0;
    }

    await this.ensureTransferCorrectionSchema(tx);

    const rows = await tx.$queryRawUnsafe<TransferCorrectionItemRow[]>(
      `
        select
          "Numero",
          "Item",
          "NumeroCaja",
          "CodigoBarra",
          "Referencia",
          "CreatedAt",
          "UpdatedAt"
        from dbo."TRANSFER_CORRECTION_ITEMS"
        where "Numero" = $1
        order by "Item" asc, "NumeroCaja" asc, "CodigoBarra" asc
      `,
      numero,
    );

    if (rows.length === 0) {
      return 0;
    }

    const barcodeToReference = new Map<string, string>();
    for (const row of rows) {
      const currentReference = barcodeToReference.get(row.CodigoBarra);
      if (currentReference && currentReference !== row.Referencia) {
        throw new ConflictException(
          `No puedes aplicar referencias distintas al articulo ${row.CodigoBarra} dentro de la misma transferencia de correccion.`,
        );
      }

      barcodeToReference.set(row.CodigoBarra, row.Referencia);
    }

    const articles = await tx.inventario.findMany({
      where: {
        CodigoBarra: { in: Array.from(barcodeToReference.keys()) },
      },
    });

    const articlesByBarcode = new Map(articles.map((item) => [item.CodigoBarra, item]));
    let updated = 0;
    const now = new Date();

    for (const [codigoBarra, referencia] of barcodeToReference.entries()) {
      const article = articlesByBarcode.get(codigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} para aplicar la correccion.`);
      }

      if (String(article.Referencia || "").trim().toUpperCase() === referencia) {
        continue;
      }

      await this.ensureUniqueTransferReferencePerBrand(tx, referencia, article.CodigoMarca, article.CodigoBarra);
      await tx.inventario.update({
        where: { CodigoBarra: article.CodigoBarra },
        data: {
          Referencia: referencia,
          UltimaActualizacion: now,
        },
      });
      updated += 1;
    }

    return updated;
  }

  private async ensureUniqueTransferReferencePerBrand(
    client: PrismaService | TransferTransactionClient,
    referencia: string,
    codigoMarca: string,
    currentCodigoBarra: string,
  ) {
    const duplicate = await client.inventario.findFirst({
      where: {
        Referencia: referencia,
        CodigoMarca: codigoMarca,
        CodigoBarra: {
          not: currentCodigoBarra,
        },
      },
      select: {
        CodigoBarra: true,
      },
    });

    if (duplicate) {
      throw new ConflictException("No puede existir otra mercancia con la misma referencia para esa marca");
    }
  }

  private async applyOriginDelta(
    tx: TransferTransactionClient,
    deltaByBarcode: Map<string, Prisma.Decimal>,
  ) {
    const codes = Array.from(deltaByBarcode.keys());
    if (codes.length === 0) {
      return;
    }

    const inventoryItems = await tx.inventario.findMany({
      where: {
        CodigoBarra: { in: codes },
      },
    });

    const inventoryByCode = new Map(inventoryItems.map((item) => [item.CodigoBarra, item]));
    const now = new Date();

    for (const [codigoBarra, delta] of deltaByBarcode.entries()) {
      const article = inventoryByCode.get(codigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} en inventario.`);
      }

      let nextExistence = article.Existencia;
      if (delta.greaterThan(0)) {
        nextExistence = article.Existencia.minus(delta);
      } else if (delta.lessThan(0)) {
        nextExistence = article.Existencia.plus(delta.abs());
      }

      await tx.inventario.update({
        where: { CodigoBarra: codigoBarra },
        data: {
          Existencia: nextExistence,
          UltimaActualizacion: now,
          FechaPrimerMovimiento: article.FechaPrimerMovimiento ?? now,
        },
      });
    }
  }

  private async applyDestinationReceipt(
    tx: TransferTransactionClient,
    numero: number,
    lines: Array<{ Cantidad: Prisma.Decimal; inventarioRef: Inventario }>,
    duplicateResolutions: Map<string, TransferDuplicateResolution>,
  ) {
    if (lines.length === 0) {
      return;
    }

    const quantitiesByIdentity = new Map<
      string,
      { quantity: Prisma.Decimal; source: Inventario }
    >();

    for (const line of lines) {
      const source = line.inventarioRef;
      const identityKey = this.buildInventoryIdentityKey(source);
      const current = quantitiesByIdentity.get(identityKey);

      quantitiesByIdentity.set(identityKey, {
        source,
        quantity: (current?.quantity ?? ZERO).plus(line.Cantidad),
      });
    }

    const identities = Array.from(quantitiesByIdentity.values());
    const existingMatches = await tx.inventario.findMany({
      where: {
        OR: identities.map(({ source }) => ({
          CodigoBarra: source.CodigoBarra,
          Referencia: source.Referencia,
          CodigoMarca: source.CodigoMarca,
        })),
      },
    });

    const matchesByIdentity = new Map(
      existingMatches.map((item) => [this.buildInventoryIdentityKey(item), item]),
    );
    const identitiesWithoutMatch = identities.filter(
      ({ source }) => !matchesByIdentity.has(this.buildInventoryIdentityKey(source)),
    );
    const collisions = identitiesWithoutMatch.length
      ? await tx.inventario.findMany({
          where: {
            CodigoBarra: { in: identitiesWithoutMatch.map(({ source }) => source.CodigoBarra) },
          },
        })
      : [];
    const collisionsByBarcode = new Map(collisions.map((item) => [item.CodigoBarra, item]));
    const unresolvedCollisions = identitiesWithoutMatch.filter(({ source }) => {
      const collision = collisionsByBarcode.get(source.CodigoBarra);
      return collision && !duplicateResolutions.has(source.CodigoBarra);
    });

    if (unresolvedCollisions.length > 0) {
      throw new ConflictException({
        message: DUPLICATE_BARCODE_MESSAGE,
        code: "TRANSFER_DUPLICATE_BARCODE",
        duplicates: unresolvedCollisions.map(({ source }) => ({
          codigoBarra: source.CodigoBarra,
          referencia: source.Referencia,
          codigoMarca: source.CodigoMarca,
          nombre: source.Nombre,
        })),
      });
    }

    const now = new Date();

    for (const { source, quantity } of identities) {
      const identityKey = this.buildInventoryIdentityKey(source);
      const destinationArticle = matchesByIdentity.get(identityKey);

      if (destinationArticle) {
        await tx.inventario.update({
          where: { CodigoBarra: destinationArticle.CodigoBarra },
          data: {
            ...this.buildReceivedInventoryAttributeUpdate(source),
            Existencia: destinationArticle.Existencia.plus(quantity),
            UltimaActualizacion: now,
            FechaPrimerMovimiento: destinationArticle.FechaPrimerMovimiento ?? now,
          },
        });

        continue;
      }

      const barcodeCollision = collisionsByBarcode.get(source.CodigoBarra);

      if (barcodeCollision) {
        const resolution = duplicateResolutions.get(source.CodigoBarra);

        if (resolution?.action === "modify-existing") {
          await tx.inventario.update({
            where: { CodigoBarra: barcodeCollision.CodigoBarra },
            data: {
              ...this.buildReceivedInventoryAttributeUpdate(source),
              Existencia: barcodeCollision.Existencia.plus(quantity),
              UltimaActualizacion: now,
              FechaPrimerMovimiento: barcodeCollision.FechaPrimerMovimiento ?? now,
            },
          });

          continue;
        }

        if (resolution?.action === "create-new") {
          const nuevoCodigoBarra = this.normalizeRequiredCode(
            resolution.nuevoCodigoBarra,
            "Debes indicar el nuevo codigo de barra para crear el articulo.",
          );
          const existingNewBarcode = await tx.inventario.findUnique({
            where: { CodigoBarra: nuevoCodigoBarra },
          });

          if (existingNewBarcode) {
            throw new ConflictException(DUPLICATE_BARCODE_MESSAGE);
          }

          await this.createReceivedInventoryArticle(tx, source, quantity, now, nuevoCodigoBarra);
          await tx.movTransferencias.updateMany({
            where: {
              Numero: numero,
              CodigoBarra: source.CodigoBarra,
            },
            data: {
              CodigoBarra: nuevoCodigoBarra,
            },
          });

          continue;
        }
      }

      await this.createReceivedInventoryArticle(tx, source, quantity, now);
    }
  }

  private async refreshTransferMovementValuesFromInventory(
    tx: TransferTransactionClient,
    lines: Array<{
      Numero: number;
      CodigoBarra: string;
      NumeroCaja: number;
      Item: number;
      Cantidad: Prisma.Decimal;
      inventarioRef: Inventario;
    }>,
  ) {
    let totalValor = ZERO;

    for (const line of lines) {
      const currentArticle = line.inventarioRef;
      const currentValue = this.resolveLineValue(currentArticle);
      totalValor = totalValor.plus(currentValue.mul(line.Cantidad));

      await tx.movTransferencias.updateMany({
        where: {
          Numero: line.Numero,
          CodigoBarra: line.CodigoBarra,
          NumeroCaja: line.NumeroCaja,
          Item: line.Item,
        },
        data: {
          Valor: currentValue,
          UltimoCosto: currentArticle.UltimoCosto,
          CostoInicial: currentArticle.CostoInicial,
          CostoDolar: currentArticle.CostoDolar,
        },
      });
    }

    return totalValor;
  }

  private async recordReceivedTransfer(
    tx: TransferTransactionClient,
    numero: number,
    totalValor: Prisma.Decimal,
  ) {
    const transfer = await tx.transferencias.findUnique({
      where: { Numero: numero },
      include: {
        movTransferencias: {
          orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
        },
      },
    });

    if (!transfer) {
      throw new NotFoundException("La transferencia no existe.");
    }

    await tx.iTransferencias.create({
      data: {
        Numero: transfer.Numero,
        CodigoEnvia: transfer.CodigoEnvia,
        CodigoRecibe: transfer.CodigoRecibe,
        Fecha: transfer.Fecha,
        FechaEmision: transfer.FechaEmision,
        TotalValor: totalValor,
        Observacion: transfer.Observacion,
        Status: 1,
        Usuario: transfer.Usuario,
        InterContable: transfer.InterContable,
        IDLote: transfer.IDLote,
        IDDespacho: transfer.IDDespacho,
        Correccion: transfer.Correccion,
      },
    });

    await tx.iMovTransferencias.createMany({
      data: transfer.movTransferencias.map((line) => ({
        Numero: transfer.Numero,
        CodigoEnvia: transfer.CodigoEnvia,
        Item: line.Item,
        Fecha: line.Fecha,
        CodigoBarra: line.CodigoBarra,
        Cantidad: line.Cantidad,
        Valor: line.Valor,
        NumeroCaja: line.NumeroCaja,
        UltimoCosto: line.UltimoCosto,
        CostoInicial: line.CostoInicial,
        CostoDolar: line.CostoDolar,
      })),
    });
  }

  private async createReceivedInventoryArticle(
    tx: TransferTransactionClient,
    source: Inventario,
    quantity: Prisma.Decimal,
    now: Date,
    codigoBarraOverride?: string,
  ) {
    await tx.inventario.create({
      data: {
        CodigoBarra: codigoBarraOverride ?? source.CodigoBarra,
        Referencia: source.Referencia,
        CodigoMarca: source.CodigoMarca,
        Nombre: source.Nombre,
        Talla: source.Talla,
        CodigoColor: source.CodigoColor,
        Fabricante: source.Fabricante,
        Categoria: source.Categoria,
        Nota: source.Nota,
        TipoImpuesto: source.TipoImpuesto,
        PrecioDetal: source.PrecioDetal,
        PrecioMayor: source.PrecioMayor,
        PrecioAfiliado: source.PrecioAfiliado,
        PrecioPromocion: source.PrecioPromocion,
        Promocion: source.Promocion,
        FechaInicial: source.FechaInicial,
        FechaFinal: source.FechaFinal,
        CostoInicial: source.CostoInicial,
        CostoPromedio: source.CostoPromedio,
        UltimoCosto: source.UltimoCosto,
        CostoDolar: source.CostoDolar,
        ExistenciaInicial: quantity,
        Existencia: quantity,
        PuntoReorden: source.PuntoReorden,
        FechaPrimerMovimiento: now,
        UltimaActualizacion: now,
        Tipo: source.Tipo,
        Status: source.Status,
        Serializado: source.Serializado,
        CodigoBarraAnt: source.CodigoBarraAnt,
      },
    });
  }

  private buildReceivedInventoryAttributeUpdate(source: Inventario): Prisma.InventarioUncheckedUpdateInput {
    return {
      Referencia: source.Referencia,
      CodigoMarca: source.CodigoMarca,
      Nombre: source.Nombre,
      Talla: source.Talla,
      CodigoColor: source.CodigoColor,
      Fabricante: source.Fabricante,
      Categoria: source.Categoria,
      Nota: source.Nota,
      TipoImpuesto: source.TipoImpuesto,
      PrecioDetal: source.PrecioDetal,
      PrecioMayor: source.PrecioMayor,
      PrecioAfiliado: source.PrecioAfiliado,
      PrecioPromocion: source.PrecioPromocion,
      Promocion: source.Promocion,
      FechaInicial: source.FechaInicial,
      FechaFinal: source.FechaFinal,
      CostoInicial: source.CostoInicial,
      CostoPromedio: source.CostoPromedio,
      UltimoCosto: source.UltimoCosto,
      CostoDolar: source.CostoDolar,
      PuntoReorden: source.PuntoReorden,
      Tipo: source.Tipo,
      Status: source.Status,
      Serializado: source.Serializado,
      CodigoBarraAnt: source.CodigoBarraAnt,
    };
  }

  private buildInventoryIdentityKey(item: Pick<Inventario, "CodigoBarra" | "Referencia" | "CodigoMarca">) {
    return [
      String(item.CodigoBarra || "").trim().toUpperCase(),
      String(item.Referencia || "").trim().toUpperCase(),
      String(item.CodigoMarca || "").trim().toUpperCase(),
    ].join("|");
  }

  private buildDuplicateResolutionMap(resolutions: TransferDuplicateResolutionDto[] | undefined) {
    const result = new Map<string, TransferDuplicateResolution>();

    for (const resolution of resolutions ?? []) {
      const codigoBarra = this.normalizeRequiredCode(resolution.codigoBarra, "Codigo de barra invalido.");
      result.set(codigoBarra, {
        action: resolution.action,
        nuevoCodigoBarra: resolution.nuevoCodigoBarra
          ? this.normalizeRequiredCode(resolution.nuevoCodigoBarra, "Codigo de barra nuevo invalido.")
          : undefined,
      });
    }

    return result;
  }

  private resolveLineValue(article: Inventario) {
    if (article.UltimoCosto && !article.UltimoCosto.isZero()) {
      return article.UltimoCosto;
    }

    if (article.CostoPromedio && !article.CostoPromedio.isZero()) {
      return article.CostoPromedio;
    }

    if (article.CostoInicial && !article.CostoInicial.isZero()) {
      return article.CostoInicial;
    }

    return ZERO;
  }

  private parsePositiveDecimal(value: string, message: string) {
    const parsed = this.parseDecimalValue(value, message);
    if (parsed.lessThanOrEqualTo(0)) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private parseNonNegativeDecimal(value: string, message: string) {
    const parsed = this.parseDecimalValue(value, message);
    if (parsed.lessThan(0)) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private parseDecimalValue(value: string, message: string) {
    try {
      return new Prisma.Decimal(String(value).trim());
    } catch {
      throw new BadRequestException(message);
    }
  }

  private normalizeRequiredCode(value: string | undefined, message: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private normalizeOptionalCode(value: string | undefined) {
    return String(value || "").trim().toUpperCase();
  }

  private isTransferSyncAutoRetryEnabled() {
    return this.readBooleanConfig("TRANSFER_SYNC_AUTO_RETRY_ENABLED", true);
  }

  private getTransferSyncAutoRetryIntervalMs() {
    return this.readPositiveIntegerConfig(
      "TRANSFER_SYNC_AUTO_RETRY_INTERVAL_MS",
      DEFAULT_TRANSFER_SYNC_AUTO_RETRY_INTERVAL_MS,
    );
  }

  private getTransferSyncAutoRetryStartupDelayMs() {
    return this.readPositiveIntegerConfig(
      "TRANSFER_SYNC_AUTO_RETRY_STARTUP_DELAY_MS",
      DEFAULT_TRANSFER_SYNC_AUTO_RETRY_STARTUP_DELAY_MS,
    );
  }

  private getTransferSyncAutoRetryLimit() {
    return this.readPositiveIntegerConfig(
      "TRANSFER_SYNC_AUTO_RETRY_LIMIT",
      DEFAULT_TRANSFER_SYNC_AUTO_RETRY_LIMIT,
    );
  }

  private async getTransferSyncInboxRowsForExport(limit: number) {
    return this.prisma.$queryRawUnsafe<TransferSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."TRANSFER_SYNC_INBOX"
        where upper("Status") in ($1, $2)
        order by coalesce("AppliedAt", "ReceivedAt") desc, "ReceivedAt" desc
        limit $3
      `,
      TRANSFER_SYNC_STATUS_RECEIVED,
      TRANSFER_SYNC_STATUS_APPLIED,
      limit,
    );
  }

  private async resolveTransferSyncPullRemoteApiUrl() {
    const explicitUrl = this.configService.get<string>("TRANSFER_SYNC_REMOTE_API_URL");
    const mirrorUrl = this.configService.get<string>("MIRROR_SYNC_REMOTE_API_URL");
    const baseUrl = this.normalizeOptionalApiUrl(explicitUrl || mirrorUrl);
    if (!baseUrl) {
      return null;
    }

    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return null;
    }

    if (url.pathname && url.pathname !== "/") {
      return baseUrl;
    }

    const inferredPath = await this.inferTransferSyncRemotePathFromLocalNode();
    if (inferredPath === null) {
      return null;
    }

    return `${baseUrl}${inferredPath}`;
  }

  private async inferTransferSyncRemotePathFromLocalNode() {
    const databasePath = this.inferTransferSyncRemotePathFromDatabaseUrl();
    if (databasePath !== null) {
      return databasePath;
    }

    const rows = await this.prisma.$queryRawUnsafe<TransferSyncNodeRow[]>(
      `
        select
          "NodeId",
          "SucursalCodigo",
          "Nombre",
          "Tipo",
          "ApiUrl",
          "CreatedAt",
          "UpdatedAt",
          "LastSeenAt"
        from dbo."SYNC_NODES"
        order by "CreatedAt" asc
      `,
    );

    if (rows.length === 0) {
      return null;
    }

    let localRow: TransferSyncNodeRow | undefined;
    if (rows.length === 1) {
      localRow = rows[0];
    } else {
      const apiPort = this.readPositiveIntegerConfig("API_PORT", 0);
      if (apiPort > 0) {
        localRow = rows.find((row) => this.apiUrlMatchesPort(row.ApiUrl, apiPort));
      }
    }

    if (!localRow) {
      return null;
    }

    const normalizedNodeId = this.normalizeSyncNodeId(localRow.NodeId);
    if (normalizedNodeId === DEFAULT_ORIGIN_CODE) {
      return "";
    }

    const tiendaMatch = normalizedNodeId.match(/^TIENDA(\d+)$/);
    if (tiendaMatch) {
      return `/tienda${tiendaMatch[1].padStart(3, "0")}`;
    }

    const bodegaMatch = normalizedNodeId.match(/^BODEGA(\d+)$/);
    if (bodegaMatch) {
      return `/bodega${bodegaMatch[1].padStart(3, "0")}`;
    }

    return null;
  }

  private inferTransferSyncRemotePathFromDatabaseUrl() {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "").trim();
    const databaseMatch = databaseUrl.match(/\/([^/?]+)(?:\?|$)/);
    const databaseName = String(databaseMatch?.[1] || "").trim().toLowerCase();
    if (!databaseName) {
      return null;
    }

    if (databaseName === "rocky_maxx" || databaseName === "rocky_sync_central") {
      return "";
    }

    const tienda = databaseName.match(/^rocky_tienda_(\d+)(?:_vps)?$/);
    if (tienda) {
      return `/tienda${tienda[1].padStart(3, "0")}`;
    }

    const bodega = databaseName.match(/^rocky_bodega_(\d+)(?:_vps)?$/);
    if (bodega) {
      return `/bodega${bodega[1].padStart(3, "0")}`;
    }

    const testNodePaths: Record<string, string> = {
      rocky_prueba_sistemas_tienda: "/prueba-sistemas-tienda",
      rocky_prueba_sistemas_bodega: "/prueba-sistemas-bodega",
      rocky_prueba_analista_tienda: "/prueba-analista-tienda",
      rocky_prueba_analista_bodega: "/prueba-analista-bodega",
    };
    return testNodePaths[databaseName] ?? null;
  }

  private apiUrlMatchesPort(apiUrl: string | null | undefined, port: number) {
    if (!apiUrl) {
      return false;
    }

    try {
      const parsed = new URL(this.normalizeRequiredApiUrl(apiUrl));
      return parsed.port === String(port);
    } catch {
      return false;
    }
  }

  private readBooleanConfig(name: string, fallback: boolean) {
    const rawValue = this.configService.get<string | boolean | number | undefined>(name);
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return fallback;
    }

    if (typeof rawValue === "boolean") {
      return rawValue;
    }

    const normalized = String(rawValue).trim().toLowerCase();
    if (["1", "true", "yes", "si", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  private readPositiveIntegerConfig(name: string, fallback: number) {
    const rawValue = this.configService.get<string | number | undefined>(name);
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return fallback;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }

  private async loadLocationsByCode(
    codes: string[],
    client: PrismaService | TransferTransactionClient = this.prisma,
  ) {
    const normalizedCodes = Array.from(new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)));
    if (normalizedCodes.length === 0) {
      return new Map<string, Sucursales>();
    }

    const locations = await client.sucursales.findMany({
      where: {
        Codigo: { in: normalizedCodes },
      },
    });

    return new Map(locations.map((location) => [location.Codigo, location]));
  }

  private toLocationView(location: Sucursales | null | undefined) {
    if (!location) {
      return null;
    }

    return {
      codigo: location.Codigo,
      nombre: location.Nombre,
      status: location.Status,
    };
  }
}

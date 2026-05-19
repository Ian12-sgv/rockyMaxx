import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { type InventoryWithRelations, inventoryInclude } from "../inventory/inventory-view.util";
import { PrismaService } from "../prisma/prisma.service";

const MIRROR_SYNC_SCHEMA_VERSION = 1;
const MIRROR_SYNC_STATUS_PENDING = "PENDING";
const MIRROR_SYNC_STATUS_SENT = "SENT";
const MIRROR_SYNC_STATUS_RECEIVED = "RECEIVED";
const MIRROR_SYNC_STATUS_APPLIED = "APPLIED";
const MIRROR_SYNC_STATUS_ERROR = "ERROR";
const MIRROR_SYNC_EVENT_INVENTORY_UPSERT = "INVENTORY_UPSERT";
const MIRROR_SYNC_EVENT_INVENTORY_DELETE = "INVENTORY_DELETE";
const MIRROR_SYNC_EVENT_CATALOG_UPSERT = "CATALOG_UPSERT";
const MIRROR_SYNC_EVENT_CATALOG_DELETE = "CATALOG_DELETE";
const DEFAULT_MIRROR_SYNC_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_MIRROR_SYNC_RETRY_STARTUP_DELAY_MS = 5_000;
const DEFAULT_MIRROR_SYNC_RETRY_LIMIT = 25;

type MirrorSyncTransactionClient = Prisma.TransactionClient;
type MirrorCatalogType = "categorias" | "marcas" | "tallas" | "colores" | "fabricantes" | "impuestos";

type MirrorSyncOutboxRow = {
  GlobalId: string;
  EntityType: string;
  EntityKey: string;
  EventType: string;
  Payload: unknown;
  Status: string;
  CreatedAt: Date;
  SentAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type MirrorSyncInboxRow = {
  GlobalId: string;
  EntityType: string;
  EntityKey: string;
  EventType: string;
  Payload: unknown;
  Status: string;
  ReceivedAt: Date;
  AppliedAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type MirrorSyncCatalogPayload = {
  codigo: string | number;
  nombre?: string | null;
  status?: number | null;
  porcentajeImpuesto?: string | null;
};

type MirrorSyncInventoryPayload = {
  codigoBarra: string;
  codigoBarraAnt: string;
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
  existencia: string;
  puntoReorden: string;
  fechaPrimerMovimiento: string;
  ultimaActualizacion: string;
  tipo: number;
  status: number;
  serializado: number;
};

type MirrorEnvelopeBase = {
  schemaVersion: number;
  globalId: string;
  sourceDatabase: string;
  entityType: string;
  entityKey: string;
};

type InventoryUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_INVENTORY_UPSERT;
  inventory: MirrorSyncInventoryPayload;
  catalogs: {
    marca: MirrorSyncCatalogPayload;
    talla: MirrorSyncCatalogPayload;
    color: MirrorSyncCatalogPayload;
    fabricante: MirrorSyncCatalogPayload;
    categoria: MirrorSyncCatalogPayload;
    impuesto: MirrorSyncCatalogPayload;
  };
};

type InventoryDeleteEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_INVENTORY_DELETE;
  inventory: {
    codigoBarra: string;
  };
};

type CatalogUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_CATALOG_UPSERT;
  catalogType: MirrorCatalogType;
  catalog: MirrorSyncCatalogPayload;
};

type CatalogDeleteEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_CATALOG_DELETE;
  catalogType: MirrorCatalogType;
  catalog: {
    codigo: string;
  };
};

type MirrorSyncEnvelope =
  | InventoryUpsertEnvelope
  | InventoryDeleteEnvelope
  | CatalogUpsertEnvelope
  | CatalogDeleteEnvelope;

type CatalogSnapshotRow = {
  Codigo: string | number;
  Nombre?: string | null;
  Status?: number | null;
  PorcentajeImpuesto?: Prisma.Decimal | null;
};

@Injectable()
export class MirrorSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MirrorSyncService.name);
  private mirrorSyncRetryTimer: ReturnType<typeof setInterval> | null = null;
  private mirrorSyncRetryStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private mirrorSyncRetryInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureMirrorSyncSchema();
    this.startMirrorSyncAutoRetry();
  }

  onModuleDestroy() {
    this.stopMirrorSyncAutoRetry();
  }

  async enqueueInventorySnapshotsTx(
    tx: MirrorSyncTransactionClient,
    rawBarcodes: Iterable<string>,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const barcodes = Array.from(
      new Set(
        Array.from(rawBarcodes)
          .map((value) => this.normalizeCode(value))
          .filter((value) => Boolean(value)),
      ),
    );

    if (barcodes.length === 0) {
      return;
    }

    const items = await tx.inventario.findMany({
      where: {
        CodigoBarra: {
          in: barcodes,
        },
      },
      include: inventoryInclude,
    });

    for (const item of items) {
      await this.recordPendingEnvelope(tx, this.buildInventoryUpsertEnvelope(item));
    }
  }

  async enqueueInventoryDeleteTx(
    tx: MirrorSyncTransactionClient,
    codigoBarra: string,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const normalizedBarcode = this.normalizeCode(codigoBarra);
    if (!normalizedBarcode) {
      return;
    }

    await this.recordPendingEnvelope(tx, this.buildInventoryDeleteEnvelope(normalizedBarcode));
  }

  async enqueueCatalogEntryUpserts(catalogType: string, rawCodes: Iterable<string>) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.enqueueCatalogEntryUpsertsTx(tx, catalogType, rawCodes);
    });
  }

  async enqueueCatalogEntryDelete(catalogType: string, codigo: string) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.enqueueCatalogEntryDeleteTx(tx, catalogType, codigo);
    });
  }

  async enqueueCatalogEntryUpsertsTx(
    tx: MirrorSyncTransactionClient,
    catalogType: string,
    rawCodes: Iterable<string>,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const resolvedType = this.normalizeCatalogType(catalogType);
    const codes = Array.from(
      new Set(
        Array.from(rawCodes)
          .map((value) => this.normalizeCatalogCode(value))
          .filter((value) => Boolean(value)),
      ),
    );

    if (codes.length === 0) {
      return;
    }

    const rows = await this.loadCatalogRows(tx, resolvedType, codes);
    for (const row of rows) {
      await this.recordPendingEnvelope(tx, this.buildCatalogUpsertEnvelope(resolvedType, row));
    }
  }

  async enqueueCatalogEntryDeleteTx(
    tx: MirrorSyncTransactionClient,
    catalogType: string,
    codigo: string,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const resolvedType = this.normalizeCatalogType(catalogType);
    const normalizedCode = this.normalizeCatalogCode(codigo);
    if (!normalizedCode) {
      return;
    }

    await this.recordPendingEnvelope(tx, this.buildCatalogDeleteEnvelope(resolvedType, normalizedCode));
  }

  async pushPendingMirrorSync(options: { limit?: number } = {}) {
    await this.ensureMirrorSyncSchema();

    if (!this.isMirrorSyncEnabled()) {
      return {
        enabled: false,
        processed: 0,
        sent: 0,
        pending: 0,
      };
    }

    const remoteApiUrl = this.getMirrorSyncRemoteApiUrl();
    if (!remoteApiUrl) {
      return {
        enabled: true,
        processed: 0,
        sent: 0,
        pending: 0,
        reason: "remote-api-url-not-configured",
      };
    }

    const rows = await this.getPendingOutboxRows(options.limit ?? this.getMirrorSyncRetryLimit());
    let sent = 0;
    let pending = 0;

    for (const row of rows) {
      const response = await this.pushOutboxRow(remoteApiUrl, row);
      if (response.status === MIRROR_SYNC_STATUS_SENT) {
        sent += 1;
      } else {
        pending += 1;
      }
    }

    return {
      enabled: true,
      processed: rows.length,
      sent,
      pending,
    };
  }

  async importMirrorPayload(body: unknown) {
    await this.ensureMirrorSyncSchema();
    const payload = this.normalizeEnvelope(body);

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const existingInbox = await this.getInboxRow(tx, payload.globalId);
          if (existingInbox?.Status === MIRROR_SYNC_STATUS_APPLIED) {
            return {
              imported: false,
              status: MIRROR_SYNC_STATUS_APPLIED,
              globalId: payload.globalId,
              entityType: payload.entityType,
              entityKey: payload.entityKey,
              message: "El paquete espejo ya habia sido aplicado.",
            };
          }

          await this.upsertInboxRow(tx, payload, MIRROR_SYNC_STATUS_RECEIVED);

          if (payload.eventType === MIRROR_SYNC_EVENT_INVENTORY_UPSERT) {
            await this.applyInventoryUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_INVENTORY_DELETE) {
            await this.applyInventoryDeleteEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_CATALOG_UPSERT) {
            await this.applyCatalogUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_CATALOG_DELETE) {
            await this.applyCatalogDeleteEnvelope(tx, payload);
          } else {
            throw new BadRequestException("Tipo de evento espejo no soportado.");
          }

          await this.updateInboxRowStatus(tx, payload.globalId, MIRROR_SYNC_STATUS_APPLIED, null);

          return {
            imported: true,
            status: MIRROR_SYNC_STATUS_APPLIED,
            globalId: payload.globalId,
            entityType: payload.entityType,
            entityKey: payload.entityKey,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return result;
    } catch (error) {
      await this.markInboxError(payload.globalId, this.extractErrorMessage(error));
      throw error;
    }
  }

  private async ensureMirrorSyncSchema() {
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."MIRROR_SYNC_OUTBOX" (
        "GlobalId" varchar(160) primary key,
        "EntityType" varchar(80) not null,
        "EntityKey" varchar(160) not null,
        "EventType" varchar(40) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null,
        "CreatedAt" timestamptz not null default now(),
        "SentAt" timestamptz null,
        "Attempts" integer not null default 0,
        "LastError" text null
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_MIRROR_SYNC_OUTBOX_Status"
      on dbo."MIRROR_SYNC_OUTBOX" ("Status", "CreatedAt")
    `);
    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_MIRROR_SYNC_OUTBOX_Entity"
      on dbo."MIRROR_SYNC_OUTBOX" ("EntityType", "EntityKey", "CreatedAt")
    `);
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."MIRROR_SYNC_INBOX" (
        "GlobalId" varchar(160) primary key,
        "EntityType" varchar(80) not null,
        "EntityKey" varchar(160) not null,
        "EventType" varchar(40) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null,
        "ReceivedAt" timestamptz not null default now(),
        "AppliedAt" timestamptz null,
        "Attempts" integer not null default 0,
        "LastError" text null
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_MIRROR_SYNC_INBOX_Status"
      on dbo."MIRROR_SYNC_INBOX" ("Status", "ReceivedAt")
    `);
  }

  private startMirrorSyncAutoRetry() {
    if (!this.isMirrorSyncEnabled()) {
      this.logger.log("Replica espejo hacia VPS deshabilitada.");
      return;
    }

    if (this.mirrorSyncRetryTimer) {
      return;
    }

    const intervalMs = this.getMirrorSyncRetryIntervalMs();
    const startupDelayMs = this.getMirrorSyncRetryStartupDelayMs();

    this.mirrorSyncRetryStartupTimer = setTimeout(() => {
      this.mirrorSyncRetryStartupTimer = null;
      void this.runMirrorSyncRetryCycle("startup");
    }, startupDelayMs);

    this.mirrorSyncRetryTimer = setInterval(() => {
      void this.runMirrorSyncRetryCycle("interval");
    }, intervalMs);

    this.logger.log(`Replica espejo activa cada ${intervalMs} ms.`);
  }

  private stopMirrorSyncAutoRetry() {
    if (this.mirrorSyncRetryStartupTimer) {
      clearTimeout(this.mirrorSyncRetryStartupTimer);
      this.mirrorSyncRetryStartupTimer = null;
    }

    if (this.mirrorSyncRetryTimer) {
      clearInterval(this.mirrorSyncRetryTimer);
      this.mirrorSyncRetryTimer = null;
    }
  }

  private async runMirrorSyncRetryCycle(reason: "startup" | "interval") {
    if (this.mirrorSyncRetryInProgress) {
      return;
    }

    this.mirrorSyncRetryInProgress = true;
    try {
      const summary = await this.pushPendingMirrorSync({ limit: this.getMirrorSyncRetryLimit() });
      if (summary.processed > 0) {
        this.logger.log(
          `Replica espejo (${reason}): procesados=${summary.processed}, enviados=${summary.sent}, pendientes=${summary.pending}.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Fallo el reintento automatico de replica espejo: ${this.extractErrorMessage(error)}`);
    } finally {
      this.mirrorSyncRetryInProgress = false;
    }
  }

  private buildInventoryUpsertEnvelope(item: InventoryWithRelations): InventoryUpsertEnvelope {
    const entityKey = item.CodigoBarra;
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId("INVENTORY", entityKey),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: "INVENTORY",
      entityKey,
      eventType: MIRROR_SYNC_EVENT_INVENTORY_UPSERT,
      inventory: {
        codigoBarra: item.CodigoBarra,
        codigoBarraAnt: item.CodigoBarraAnt,
        referencia: item.Referencia,
        codigoMarca: item.CodigoMarca,
        nombre: item.Nombre,
        talla: item.Talla,
        codigoColor: item.CodigoColor,
        fabricante: item.Fabricante,
        categoria: item.Categoria,
        nota: item.Nota,
        tipoImpuesto: item.TipoImpuesto,
        precioDetal: item.PrecioDetal.toString(),
        precioMayor: item.PrecioMayor.toString(),
        precioAfiliado: item.PrecioAfiliado.toString(),
        precioPromocion: item.PrecioPromocion.toString(),
        promocion: item.Promocion,
        fechaInicial: item.FechaInicial.toISOString(),
        fechaFinal: item.FechaFinal.toISOString(),
        costoInicial: item.CostoInicial.toString(),
        costoPromedio: item.CostoPromedio.toString(),
        ultimoCosto: item.UltimoCosto.toString(),
        costoDolar: item.CostoDolar.toString(),
        existenciaInicial: item.ExistenciaInicial.toString(),
        existencia: item.Existencia.toString(),
        puntoReorden: item.PuntoReorden.toString(),
        fechaPrimerMovimiento: (item.FechaPrimerMovimiento ?? item.FechaInicial).toISOString(),
        ultimaActualizacion: (item.UltimaActualizacion ?? item.FechaFinal ?? item.FechaInicial).toISOString(),
        tipo: item.Tipo,
        status: item.Status,
        serializado: item.Serializado,
      },
      catalogs: {
        marca: {
          codigo: item.marcaRef.Codigo,
          nombre: item.marcaRef.Nombre,
          status: item.marcaRef.Status,
        },
        talla: {
          codigo: item.tallaRef.Codigo,
        },
        color: {
          codigo: item.colorRef.Codigo,
          nombre: item.colorRef.Nombre,
          status: item.colorRef.Status,
        },
        fabricante: {
          codigo: item.fabricanteRef.Codigo,
          nombre: item.fabricanteRef.Nombre,
          status: item.fabricanteRef.Status,
        },
        categoria: {
          codigo: item.categoriaRef.Codigo,
          nombre: item.categoriaRef.Nombre,
          status: item.categoriaRef.Status,
        },
        impuesto: {
          codigo: item.impuestoRef.Codigo,
          nombre: item.impuestoRef.Nombre,
          porcentajeImpuesto: item.impuestoRef.PorcentajeImpuesto?.toString() ?? null,
        },
      },
    };
  }

  private buildInventoryDeleteEnvelope(codigoBarra: string): InventoryDeleteEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId("INVENTORY", codigoBarra),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: "INVENTORY",
      entityKey: codigoBarra,
      eventType: MIRROR_SYNC_EVENT_INVENTORY_DELETE,
      inventory: {
        codigoBarra,
      },
    };
  }

  private buildCatalogUpsertEnvelope(
    catalogType: MirrorCatalogType,
    row: CatalogSnapshotRow,
  ): CatalogUpsertEnvelope {
    const codigo = this.normalizeCatalogCode(row.Codigo);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId(`CATALOG:${catalogType}`, codigo),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: `CATALOG:${catalogType}`,
      entityKey: codigo,
      eventType: MIRROR_SYNC_EVENT_CATALOG_UPSERT,
      catalogType,
      catalog: {
        codigo,
        nombre: row.Nombre ?? null,
        status: row.Status ?? null,
        porcentajeImpuesto: row.PorcentajeImpuesto?.toString() ?? null,
      },
    };
  }

  private buildCatalogDeleteEnvelope(
    catalogType: MirrorCatalogType,
    codigo: string,
  ): CatalogDeleteEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId(`CATALOG:${catalogType}`, codigo),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: `CATALOG:${catalogType}`,
      entityKey: codigo,
      eventType: MIRROR_SYNC_EVENT_CATALOG_DELETE,
      catalogType,
      catalog: {
        codigo,
      },
    };
  }

  private async recordPendingEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: MirrorSyncEnvelope,
  ) {
    const existing = await tx.$queryRawUnsafe<Pick<MirrorSyncOutboxRow, "GlobalId">[]>(
      `
        select "GlobalId"
        from dbo."MIRROR_SYNC_OUTBOX"
        where "EntityType" = $1
          and "EntityKey" = $2
          and "Status" = $3
        order by "CreatedAt" desc
        limit 1
      `,
      payload.entityType,
      payload.entityKey,
      MIRROR_SYNC_STATUS_PENDING,
    );

    if (existing.length > 0) {
      await tx.$executeRawUnsafe(
        `
          update dbo."MIRROR_SYNC_OUTBOX"
          set
            "EventType" = $2,
            "Payload" = $3::jsonb,
            "Attempts" = 0,
            "LastError" = null,
            "SentAt" = null,
            "CreatedAt" = now()
          where "GlobalId" = $1
        `,
        existing[0].GlobalId,
        payload.eventType,
        JSON.stringify(payload),
      );
      return;
    }

    await tx.$executeRawUnsafe(
      `
        insert into dbo."MIRROR_SYNC_OUTBOX"
          ("GlobalId", "EntityType", "EntityKey", "EventType", "Payload", "Status", "CreatedAt", "SentAt", "Attempts", "LastError")
        values ($1, $2, $3, $4, $5::jsonb, $6, now(), null, 0, null)
      `,
      payload.globalId,
      payload.entityType,
      payload.entityKey,
      payload.eventType,
      JSON.stringify(payload),
      MIRROR_SYNC_STATUS_PENDING,
    );
  }

  private async getPendingOutboxRows(limit: number) {
    return this.prisma.$queryRawUnsafe<MirrorSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "EntityType",
          "EntityKey",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."MIRROR_SYNC_OUTBOX"
        where "Status" = $1
        order by "CreatedAt" asc
        limit $2
      `,
      MIRROR_SYNC_STATUS_PENDING,
      limit,
    );
  }

  private async pushOutboxRow(remoteApiUrl: string, row: MirrorSyncOutboxRow) {
    try {
      if (this.isLocalApiUrl(remoteApiUrl)) {
        throw new BadRequestException("La URL del VPS no puede apuntar al mismo backend local.");
      }

      const payload = this.parseEnvelopePayload(row.Payload);
      await this.postMirrorSyncPackage(remoteApiUrl, payload);
      await this.updateOutboxRowStatus(row.GlobalId, MIRROR_SYNC_STATUS_SENT, null);
      return {
        globalId: row.GlobalId,
        status: MIRROR_SYNC_STATUS_SENT,
      };
    } catch (error) {
      const message = this.extractErrorMessage(error);
      await this.updateOutboxRowStatus(row.GlobalId, MIRROR_SYNC_STATUS_PENDING, message);
      return {
        globalId: row.GlobalId,
        status: MIRROR_SYNC_STATUS_PENDING,
        error: message,
      };
    }
  }

  private async updateOutboxRowStatus(globalId: string, status: string, lastError: string | null) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."MIRROR_SYNC_OUTBOX"
        set
          "Status" = $2,
          "SentAt" = case when $2 = $3 then now() else null end,
          "Attempts" = dbo."MIRROR_SYNC_OUTBOX"."Attempts" + 1,
          "LastError" = $4
        where "GlobalId" = $1
      `,
      globalId,
      status,
      MIRROR_SYNC_STATUS_SENT,
      lastError,
    );
  }

  private async getInboxRow(tx: MirrorSyncTransactionClient, globalId: string) {
    const rows = await tx.$queryRawUnsafe<MirrorSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "EntityType",
          "EntityKey",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."MIRROR_SYNC_INBOX"
        where "GlobalId" = $1
        limit 1
      `,
      globalId,
    );

    return rows[0] ?? null;
  }

  private async upsertInboxRow(
    tx: MirrorSyncTransactionClient,
    payload: MirrorSyncEnvelope,
    status: string,
  ) {
    await tx.$executeRawUnsafe(
      `
        insert into dbo."MIRROR_SYNC_INBOX"
          ("GlobalId", "EntityType", "EntityKey", "EventType", "Payload", "Status", "ReceivedAt", "AppliedAt", "Attempts", "LastError")
        values ($1, $2, $3, $4, $5::jsonb, $6, now(), null, 0, null)
        on conflict ("GlobalId") do update set
          "EntityType" = excluded."EntityType",
          "EntityKey" = excluded."EntityKey",
          "EventType" = excluded."EventType",
          "Payload" = excluded."Payload",
          "Status" = excluded."Status",
          "ReceivedAt" = now(),
          "Attempts" = 0,
          "LastError" = null
      `,
      payload.globalId,
      payload.entityType,
      payload.entityKey,
      payload.eventType,
      JSON.stringify(payload),
      status,
    );
  }

  private async updateInboxRowStatus(
    tx: MirrorSyncTransactionClient,
    globalId: string,
    status: string,
    lastError: string | null,
  ) {
    await tx.$executeRawUnsafe(
      `
        update dbo."MIRROR_SYNC_INBOX"
        set
          "Status" = $2,
          "AppliedAt" = case when $2 = $3 then now() else null end,
          "Attempts" = dbo."MIRROR_SYNC_INBOX"."Attempts" + 1,
          "LastError" = $4
        where "GlobalId" = $1
      `,
      globalId,
      status,
      MIRROR_SYNC_STATUS_APPLIED,
      lastError,
    );
  }

  private async markInboxError(globalId: string, message: string) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."MIRROR_SYNC_INBOX"
        set
          "Status" = $2,
          "Attempts" = dbo."MIRROR_SYNC_INBOX"."Attempts" + 1,
          "LastError" = $3
        where "GlobalId" = $1
      `,
      globalId,
      MIRROR_SYNC_STATUS_ERROR,
      message,
    );
  }

  private async applyInventoryUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: InventoryUpsertEnvelope,
  ) {
    await this.upsertCatalogFromPayload(tx, "marcas", payload.catalogs.marca);
    await this.upsertCatalogFromPayload(tx, "tallas", payload.catalogs.talla);
    await this.upsertCatalogFromPayload(tx, "colores", payload.catalogs.color);
    await this.upsertCatalogFromPayload(tx, "fabricantes", payload.catalogs.fabricante);
    await this.upsertCatalogFromPayload(tx, "categorias", payload.catalogs.categoria);
    await this.upsertCatalogFromPayload(tx, "impuestos", payload.catalogs.impuesto);

    const item = payload.inventory;
    await tx.inventario.upsert({
      where: { CodigoBarra: item.codigoBarra },
      create: {
        CodigoBarra: item.codigoBarra,
        CodigoBarraAnt: item.codigoBarraAnt,
        Referencia: item.referencia,
        CodigoMarca: item.codigoMarca,
        Nombre: item.nombre,
        Talla: item.talla,
        CodigoColor: item.codigoColor,
        Fabricante: item.fabricante,
        Categoria: item.categoria,
        Nota: item.nota,
        TipoImpuesto: item.tipoImpuesto,
        PrecioDetal: item.precioDetal,
        PrecioMayor: item.precioMayor,
        PrecioAfiliado: item.precioAfiliado,
        PrecioPromocion: item.precioPromocion,
        Promocion: item.promocion,
        FechaInicial: new Date(item.fechaInicial),
        FechaFinal: new Date(item.fechaFinal),
        CostoInicial: item.costoInicial,
        CostoPromedio: item.costoPromedio,
        UltimoCosto: item.ultimoCosto,
        CostoDolar: item.costoDolar,
        ExistenciaInicial: item.existenciaInicial,
        Existencia: item.existencia,
        PuntoReorden: item.puntoReorden,
        FechaPrimerMovimiento: new Date(item.fechaPrimerMovimiento),
        UltimaActualizacion: new Date(item.ultimaActualizacion),
        Tipo: item.tipo,
        Status: item.status,
        Serializado: item.serializado,
      },
      update: {
        CodigoBarraAnt: item.codigoBarraAnt,
        Referencia: item.referencia,
        CodigoMarca: item.codigoMarca,
        Nombre: item.nombre,
        Talla: item.talla,
        CodigoColor: item.codigoColor,
        Fabricante: item.fabricante,
        Categoria: item.categoria,
        Nota: item.nota,
        TipoImpuesto: item.tipoImpuesto,
        PrecioDetal: item.precioDetal,
        PrecioMayor: item.precioMayor,
        PrecioAfiliado: item.precioAfiliado,
        PrecioPromocion: item.precioPromocion,
        Promocion: item.promocion,
        FechaInicial: new Date(item.fechaInicial),
        FechaFinal: new Date(item.fechaFinal),
        CostoInicial: item.costoInicial,
        CostoPromedio: item.costoPromedio,
        UltimoCosto: item.ultimoCosto,
        CostoDolar: item.costoDolar,
        ExistenciaInicial: item.existenciaInicial,
        Existencia: item.existencia,
        PuntoReorden: item.puntoReorden,
        FechaPrimerMovimiento: new Date(item.fechaPrimerMovimiento),
        UltimaActualizacion: new Date(item.ultimaActualizacion),
        Tipo: item.tipo,
        Status: item.status,
        Serializado: item.serializado,
      },
    });
  }

  private async applyInventoryDeleteEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: InventoryDeleteEnvelope,
  ) {
    const codigoBarra = payload.inventory.codigoBarra;
    const existing = await tx.inventario.findUnique({
      where: { CodigoBarra: codigoBarra },
    });

    if (!existing) {
      return;
    }

    await tx.inventario.delete({
      where: { CodigoBarra: codigoBarra },
    });
  }

  private async applyCatalogUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: CatalogUpsertEnvelope,
  ) {
    await this.upsertCatalogFromPayload(tx, payload.catalogType, payload.catalog);
  }

  private async applyCatalogDeleteEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: CatalogDeleteEnvelope,
  ) {
    const codigo = this.normalizeCatalogCode(payload.catalog.codigo);
    if (!codigo) {
      return;
    }

    if (payload.catalogType === "tallas") {
      await tx.tallas.deleteMany({
        where: { Codigo: codigo },
      });
      return;
    }

    if (payload.catalogType === "categorias") {
      await tx.categorias.deleteMany({ where: { Codigo: codigo } });
      return;
    }

    if (payload.catalogType === "marcas") {
      await tx.marcas.deleteMany({ where: { Codigo: codigo } });
      return;
    }

    if (payload.catalogType === "colores") {
      await tx.colores.deleteMany({ where: { Codigo: codigo } });
      return;
    }

    if (payload.catalogType === "fabricantes") {
      await tx.fabricantes.deleteMany({ where: { Codigo: codigo } });
      return;
    }

    if (payload.catalogType === "impuestos") {
      await tx.impuestos.deleteMany({
        where: { Codigo: this.toNonNegativeInteger(codigo, "Codigo de impuesto invalido.") },
      });
    }
  }

  private async upsertCatalogFromPayload(
    tx: MirrorSyncTransactionClient,
    catalogType: MirrorCatalogType,
    payload: MirrorSyncCatalogPayload,
  ) {
    if (catalogType === "tallas") {
      const codigo = this.normalizeCatalogCode(payload.codigo);
      if (!codigo) {
        throw new BadRequestException("Codigo de talla invalido.");
      }

      await tx.tallas.upsert({
        where: { Codigo: codigo },
        create: { Codigo: codigo },
        update: {},
      });
      return;
    }

    if (catalogType === "impuestos") {
      const codigo = this.toNonNegativeInteger(payload.codigo, "Codigo de impuesto invalido.");
      await tx.impuestos.upsert({
        where: { Codigo: codigo },
        create: {
          Codigo: codigo,
          Nombre: payload.nombre ?? null,
          PorcentajeImpuesto: payload.porcentajeImpuesto ?? "0",
        },
        update: {
          Nombre: payload.nombre ?? null,
          PorcentajeImpuesto: payload.porcentajeImpuesto ?? "0",
        },
      });
      return;
    }

    const codigo = this.normalizeCatalogCode(payload.codigo);
    if (!codigo) {
      throw new BadRequestException("Codigo de catalogo invalido.");
    }

    const data = {
      Codigo: codigo,
      Nombre: payload.nombre ?? codigo,
      Status: payload.status ?? 1,
    };

    if (catalogType === "categorias") {
      await tx.categorias.upsert({
        where: { Codigo: codigo },
        create: data,
        update: {
          Nombre: data.Nombre,
          Status: data.Status,
        },
      });
      return;
    }

    if (catalogType === "marcas") {
      await tx.marcas.upsert({
        where: { Codigo: codigo },
        create: data,
        update: {
          Nombre: data.Nombre,
          Status: data.Status,
        },
      });
      return;
    }

    if (catalogType === "colores") {
      await tx.colores.upsert({
        where: { Codigo: codigo },
        create: data,
        update: {
          Nombre: data.Nombre,
          Status: data.Status,
        },
      });
      return;
    }

    if (catalogType === "fabricantes") {
      await tx.fabricantes.upsert({
        where: { Codigo: codigo },
        create: data,
        update: {
          Nombre: data.Nombre,
          Status: data.Status,
        },
      });
    }
  }

  private async loadCatalogRows(
    tx: MirrorSyncTransactionClient,
    catalogType: MirrorCatalogType,
    codes: string[],
  ) {
    if (catalogType === "categorias") {
      return tx.categorias.findMany({ where: { Codigo: { in: codes } } });
    }
    if (catalogType === "marcas") {
      return tx.marcas.findMany({ where: { Codigo: { in: codes } } });
    }
    if (catalogType === "tallas") {
      return tx.tallas.findMany({ where: { Codigo: { in: codes } } });
    }
    if (catalogType === "colores") {
      return tx.colores.findMany({ where: { Codigo: { in: codes } } });
    }
    if (catalogType === "fabricantes") {
      return tx.fabricantes.findMany({ where: { Codigo: { in: codes } } });
    }
    return tx.impuestos.findMany({
      where: {
        Codigo: {
          in: codes.map((code) => this.toNonNegativeInteger(code, "Codigo de impuesto invalido.")),
        },
      },
    });
  }

  private async postMirrorSyncPackage(baseUrl: string, payload: MirrorSyncEnvelope) {
    const token = await this.loginRemoteMirrorNode(baseUrl);
    const response = await fetch(`${baseUrl}/api/mirror-sync/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(body || `El VPS respondio con ${response.status}.`);
    }

    return response.json().catch(() => null);
  }

  private async loginRemoteMirrorNode(baseUrl: string) {
    const usuario = this.configService.get<string>(
      "MIRROR_SYNC_USERNAME",
      this.configService.get<string>(
        "TRANSFER_SYNC_USERNAME",
        this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_USERNAME", "sistema"),
      ),
    );
    const password = this.configService.get<string>(
      "MIRROR_SYNC_PASSWORD",
      this.configService.get<string>(
        "TRANSFER_SYNC_PASSWORD",
        this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_PASSWORD", "456789"),
      ),
    );

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usuario,
        password,
      }),
    });

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(body || `No se pudo autenticar la replica en ${baseUrl}.`);
    }

    const data = (await response.json()) as { accessToken?: string };
    if (!data.accessToken) {
      throw new Error("La autenticacion remota no devolvio accessToken.");
    }

    return data.accessToken;
  }

  private async readResponseBody(response: Response) {
    const body = await response.text();
    return String(body || "").trim();
  }

  private normalizeEnvelope(raw: unknown): MirrorSyncEnvelope {
    if (!this.isRecord(raw)) {
      throw new BadRequestException("Paquete espejo invalido.");
    }

    const schemaVersion = this.toNonNegativeInteger(raw.schemaVersion, "Version de replica invalida.");
    if (schemaVersion !== MIRROR_SYNC_SCHEMA_VERSION) {
      throw new BadRequestException("Version de replica no soportada.");
    }

    const eventType = String(raw.eventType || "").trim().toUpperCase();
    if (!eventType) {
      throw new BadRequestException("Tipo de evento espejo invalido.");
    }

    if (eventType === MIRROR_SYNC_EVENT_INVENTORY_UPSERT) {
      return this.normalizeInventoryUpsertEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_INVENTORY_DELETE) {
      return this.normalizeInventoryDeleteEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_CATALOG_UPSERT) {
      return this.normalizeCatalogUpsertEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_CATALOG_DELETE) {
      return this.normalizeCatalogDeleteEnvelope(raw);
    }

    throw new BadRequestException("Tipo de evento espejo no soportado.");
  }

  private normalizeInventoryUpsertEnvelope(raw: Record<string, unknown>): InventoryUpsertEnvelope {
    const inventory = this.asRecord(raw.inventory);
    const catalogs = this.asRecord(raw.catalogs);

    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_INVENTORY_UPSERT,
      inventory: {
        codigoBarra: this.normalizeRequiredCode(inventory.codigoBarra, "Codigo de barra invalido."),
        codigoBarraAnt: this.normalizeOptionalString(inventory.codigoBarraAnt),
        referencia: this.normalizeRequiredString(inventory.referencia, "Referencia invalida."),
        codigoMarca: this.normalizeRequiredString(inventory.codigoMarca, "Marca invalida."),
        nombre: this.normalizeRequiredString(inventory.nombre, "Nombre invalido."),
        talla: this.normalizeRequiredString(inventory.talla, "Talla invalida."),
        codigoColor: this.normalizeRequiredString(inventory.codigoColor, "Color invalido."),
        fabricante: this.normalizeRequiredString(inventory.fabricante, "Fabricante invalido."),
        categoria: this.normalizeRequiredString(inventory.categoria, "Categoria invalida."),
        nota: inventory.nota == null ? null : String(inventory.nota),
        tipoImpuesto: this.toNonNegativeInteger(inventory.tipoImpuesto, "Impuesto invalido."),
        precioDetal: this.normalizeDecimalString(inventory.precioDetal, "Precio detal invalido."),
        precioMayor: this.normalizeDecimalString(inventory.precioMayor, "Precio mayor invalido."),
        precioAfiliado: this.normalizeDecimalString(inventory.precioAfiliado, "Precio afiliado invalido."),
        precioPromocion: this.normalizeDecimalString(inventory.precioPromocion, "Precio promocion invalido."),
        promocion: Boolean(inventory.promocion),
        fechaInicial: this.normalizeIsoDateString(inventory.fechaInicial, "Fecha inicial invalida."),
        fechaFinal: this.normalizeIsoDateString(inventory.fechaFinal, "Fecha final invalida."),
        costoInicial: this.normalizeDecimalString(inventory.costoInicial, "Costo inicial invalido."),
        costoPromedio: this.normalizeDecimalString(inventory.costoPromedio, "Costo promedio invalido."),
        ultimoCosto: this.normalizeDecimalString(inventory.ultimoCosto, "Ultimo costo invalido."),
        costoDolar: this.normalizeDecimalString(inventory.costoDolar, "Costo dolar invalido."),
        existenciaInicial: this.normalizeDecimalString(inventory.existenciaInicial, "Existencia inicial invalida."),
        existencia: this.normalizeDecimalString(inventory.existencia, "Existencia invalida."),
        puntoReorden: this.normalizeDecimalString(inventory.puntoReorden, "Punto de reorden invalido."),
        fechaPrimerMovimiento: this.normalizeIsoDateString(
          inventory.fechaPrimerMovimiento,
          "Fecha de primer movimiento invalida.",
        ),
        ultimaActualizacion: this.normalizeIsoDateString(
          inventory.ultimaActualizacion,
          "Ultima actualizacion invalida.",
        ),
        tipo: this.toNonNegativeInteger(inventory.tipo, "Tipo de articulo invalido."),
        status: this.toNonNegativeInteger(inventory.status, "Status de articulo invalido."),
        serializado: this.toNonNegativeInteger(inventory.serializado, "Serializado invalido."),
      },
      catalogs: {
        marca: this.normalizeCatalogPayload(catalogs.marca),
        talla: this.normalizeCatalogPayload(catalogs.talla),
        color: this.normalizeCatalogPayload(catalogs.color),
        fabricante: this.normalizeCatalogPayload(catalogs.fabricante),
        categoria: this.normalizeCatalogPayload(catalogs.categoria),
        impuesto: this.normalizeCatalogPayload(catalogs.impuesto),
      },
    };
  }

  private normalizeInventoryDeleteEnvelope(raw: Record<string, unknown>): InventoryDeleteEnvelope {
    const inventory = this.asRecord(raw.inventory);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_INVENTORY_DELETE,
      inventory: {
        codigoBarra: this.normalizeRequiredCode(inventory.codigoBarra, "Codigo de barra invalido."),
      },
    };
  }

  private normalizeCatalogUpsertEnvelope(raw: Record<string, unknown>): CatalogUpsertEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_CATALOG_UPSERT,
      catalogType: this.normalizeCatalogType(raw.catalogType),
      catalog: this.normalizeCatalogPayload(raw.catalog),
    };
  }

  private normalizeCatalogDeleteEnvelope(raw: Record<string, unknown>): CatalogDeleteEnvelope {
    const catalog = this.asRecord(raw.catalog);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_CATALOG_DELETE,
      catalogType: this.normalizeCatalogType(raw.catalogType),
      catalog: {
        codigo: this.normalizeRequiredCode(catalog.codigo, "Codigo de catalogo invalido."),
      },
    };
  }

  private normalizeCatalogPayload(raw: unknown): MirrorSyncCatalogPayload {
    const value = this.asRecord(raw);
    return {
      codigo: String(value.codigo ?? "").trim(),
      nombre: value.nombre == null ? null : String(value.nombre),
      status: value.status == null ? null : this.toNonNegativeInteger(value.status, "Status de catalogo invalido."),
      porcentajeImpuesto:
        value.porcentajeImpuesto == null ? null : this.normalizeDecimalString(value.porcentajeImpuesto, "Porcentaje de impuesto invalido."),
    };
  }

  private parseEnvelopePayload(payload: unknown) {
    const raw = this.parseRawJson(payload);
    return this.normalizeEnvelope(raw);
  }

  private parseRawJson(value: unknown) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        throw new BadRequestException("Payload espejo invalido.");
      }
    }

    if (this.isRecord(value)) {
      return value;
    }

    throw new BadRequestException("Payload espejo invalido.");
  }

  private normalizeCatalogType(value: unknown): MirrorCatalogType {
    const normalized = String(value || "").trim().toLowerCase();
    if (
      normalized === "categorias"
      || normalized === "marcas"
      || normalized === "tallas"
      || normalized === "colores"
      || normalized === "fabricantes"
      || normalized === "impuestos"
    ) {
      return normalized;
    }

    throw new BadRequestException("Tipo de catalogo invalido.");
  }

  private normalizeCode(value: unknown) {
    return String(value || "").trim().toUpperCase();
  }

  private normalizeCatalogCode(value: unknown) {
    return String(value || "").trim().toUpperCase();
  }

  private normalizeOptionalString(value: unknown) {
    return String(value || "").trim();
  }

  private normalizeRequiredCode(value: unknown, message: string) {
    const normalized = this.normalizeCode(value);
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private normalizeRequiredString(value: unknown, message: string) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private normalizeDecimalString(value: unknown, message: string) {
    try {
      return new Prisma.Decimal(String(value ?? "0")).toString();
    } catch {
      throw new BadRequestException(message);
    }
  }

  private normalizeIsoDateString(value: unknown, message: string) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(message);
    }

    return date.toISOString();
  }

  private toNonNegativeInteger(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new BadRequestException(message);
    }

    return number;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private asRecord(value: unknown) {
    if (!this.isRecord(value)) {
      throw new BadRequestException("Payload espejo invalido.");
    }

    return value;
  }

  private isMirrorSyncEnabled() {
    return this.readBooleanConfig("MIRROR_SYNC_ENABLED", false);
  }

  private getMirrorSyncRemoteApiUrl() {
    const raw = this.configService.get<string>("MIRROR_SYNC_REMOTE_API_URL", "");
    const normalized = String(raw || "").trim().replace(/\/+$/, "");
    return normalized || null;
  }

  private isLocalApiUrl(remoteApiUrl: string) {
    const normalizedRemote = String(remoteApiUrl || "").trim().replace(/\/+$/, "").toLowerCase();
    const port = String(this.configService.get<string>("API_PORT", "3000") || "3000").trim() || "3000";
    return normalizedRemote === `http://127.0.0.1:${port}` || normalizedRemote === `http://localhost:${port}`;
  }

  private getMirrorSyncRetryIntervalMs() {
    return this.readIntegerConfig("MIRROR_SYNC_AUTO_RETRY_INTERVAL_MS", DEFAULT_MIRROR_SYNC_RETRY_INTERVAL_MS);
  }

  private getMirrorSyncRetryStartupDelayMs() {
    return this.readIntegerConfig("MIRROR_SYNC_AUTO_RETRY_STARTUP_DELAY_MS", DEFAULT_MIRROR_SYNC_RETRY_STARTUP_DELAY_MS);
  }

  private getMirrorSyncRetryLimit() {
    return this.readIntegerConfig("MIRROR_SYNC_AUTO_RETRY_LIMIT", DEFAULT_MIRROR_SYNC_RETRY_LIMIT);
  }

  private readBooleanConfig(key: string, fallback: boolean) {
    const raw = this.configService.get<string | boolean>(key, fallback);
    if (typeof raw === "boolean") {
      return raw;
    }

    const normalized = String(raw || "").trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }

    if (["1", "true", "yes", "si", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  private readIntegerConfig(key: string, fallback: number) {
    const raw = Number(this.configService.get<string | number>(key, fallback));
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }

    return Math.trunc(raw);
  }

  private getCurrentDatabaseName() {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    const match = databaseUrl.match(/\/([^/?]+)(\?|$)/);
    return String(match?.[1] || "").trim() || "local";
  }

  private buildGlobalId(entityType: string, entityKey: string) {
    return `${this.getCurrentDatabaseName().toUpperCase()}-${entityType}-${entityKey}-${Date.now()}`;
  }

  private extractErrorMessage(error: unknown) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === "string") {
        return response;
      }

      if (this.isRecord(response) && typeof response.message === "string") {
        return response.message;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Error desconocido.";
  }
}

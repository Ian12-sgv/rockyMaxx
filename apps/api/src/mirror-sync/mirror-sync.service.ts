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
const MIRROR_SYNC_EVENT_CLIENT_UPSERT = "CLIENT_UPSERT";
const MIRROR_SYNC_EVENT_WORKER_UPSERT = "WORKER_UPSERT";
const MIRROR_SYNC_EVENT_RATE_UPSERT = "RATE_UPSERT";
const MIRROR_SYNC_EVENT_SALE_UPSERT = "SALE_UPSERT";
const MIRROR_SYNC_EVENT_CAJA_UPSERT = "CAJA_UPSERT";
const DEFAULT_MIRROR_SYNC_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_MIRROR_SYNC_RETRY_STARTUP_DELAY_MS = 5_000;
const DEFAULT_MIRROR_SYNC_RETRY_LIMIT = 200;
const DEFAULT_MIRROR_SYNC_RETRY_MAX_BATCHES = 25;
const MIRROR_SYNC_AUTH_REFRESH_BUFFER_MS = 30_000;

type MirrorSyncTransactionClient = Prisma.TransactionClient;
type MirrorCatalogType = "categorias" | "marcas" | "tallas" | "colores" | "fabricantes" | "impuestos";
type MirrorRateTable = "TASA_CAMBIO" | "TASA_CAMBIO_M";
type ClienteWithRelations = Prisma.ClientesGetPayload<{
  include: {
    tipoCliente: true;
    contribuyenteTipo: true;
  };
}>;
type TrabajadorWithRelations = Prisma.TrabajadoresGetPayload<{
  include: {
    cargoRef: true;
  };
}>;
type VentaWithRelations = Prisma.VentasGetPayload<{
  include: {
    movVentas: true;
    clienteRef: {
      include: {
        tipoCliente: true;
        contribuyenteTipo: true;
      };
    };
    trabajadorRef: {
      include: {
        cargoRef: true;
      };
    };
  };
}>;
type CajaWithImpresora = Prisma.CajasGetPayload<{
  include: {
    impresoraFiscal: true;
  };
}>;

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

type MirrorSyncAuthCacheEntry = {
  baseUrl: string;
  token: string;
  expiresAt: number | null;
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

type MirrorSyncClientTypePayload = {
  codigo: number;
  descripcion?: string | null;
  status?: number | null;
};

type MirrorSyncClientePayload = {
  codigo: string;
  nombre: string;
  fechaIngreso: string;
  telefono: string;
  direccion: string;
  status: number;
  tipo: number;
  tipoContribuyente: number;
};

type MirrorSyncCargoPayload = {
  codigo: string;
  nombre?: string | null;
  status?: number | null;
};

type MirrorSyncTrabajadorPayload = {
  cedula: string;
  codigo: number;
  nombre: string;
  cargo: string;
  fechaIngreso: string;
  fechaNacimiento: string | null;
  direccion: string | null;
  telefono: string | null;
  celular: string | null;
  status: number;
  marcajeInterDiario: boolean;
  indUsarCarnet: number;
};

type MirrorSyncRatePayload = {
  id: string;
  fecha: string;
  valor: string;
};

type MirrorSyncSalePayload = {
  numeroFactura: string;
  serie: string;
  fecha: string;
  vendedor: string;
  cliente: string;
  tipoVenta: number;
  formaPago: number;
  diasCredito: number;
  totalMercancia: string;
  totalDescuento: string;
  totalImpuesto: string;
  totalCosto: string;
  interContable: number;
  usuario: string;
  status: number;
  numeroOrden: string;
  totalPago: string;
  totalDolares: string | null;
  tasaCambio: string | null;
  estacion: string | null;
  totalDolaresE: string | null;
  tasaIGTF: string | null;
  montoIGTF: string | null;
  baseImponibleIGTF: string | null;
};

type MirrorSyncSaleLinePayload = {
  numeroFactura: string;
  serie: string;
  hora: string;
  tipoLista: string;
  codigoBarra: string;
  precio: string;
  precioLista: string;
  costo: string;
  impuesto: string;
  porcentajeImpuesto: string;
  cantidad: string;
  cantidadDevuelta: string;
  item: number;
  porcentajeDescuento: string;
  precioDetal: string;
  regla: string;
  idRegla: number;
};

type MirrorSyncImpresoraFiscalPayload = {
  id: number;
  nombreImpresora: string | null;
  status: number | null;
  idProcesoImpresion: number | null;
  montoMaximoDiario: string | null;
  incluyeIGTF: boolean;
};

type MirrorSyncCajaPayload = {
  serie: string;
  numero: number;
  fondoCaja: string;
  tipoListaPrecio: number;
  tipoVenta: number;
  tipoReporte: number;
  ultimaFactura: string;
  ultimaDevolucion: string;
  permiteDescuento: number;
  permiteFacturasExentas: number;
  permiteAlternarListas: number;
  cambiarPrecios: number;
  requerirAutorizacion: number;
  idImpresoraFiscal: number;
  nombreImpresora: string | null;
  numeroCopias: number | null;
  incluirIGTF: boolean | null;
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

type ClientUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_CLIENT_UPSERT;
  cliente: MirrorSyncClientePayload;
  tipoCliente: MirrorSyncClientTypePayload;
  tipoContribuyente: MirrorSyncClientTypePayload;
};

type WorkerUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_WORKER_UPSERT;
  trabajador: MirrorSyncTrabajadorPayload;
  cargo: MirrorSyncCargoPayload;
};

type RateUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_RATE_UPSERT;
  rateTable: MirrorRateTable;
  rate: MirrorSyncRatePayload;
};

type MirrorSyncClientSnapshot = {
  cliente: MirrorSyncClientePayload;
  tipoCliente: MirrorSyncClientTypePayload;
  tipoContribuyente: MirrorSyncClientTypePayload;
};

type MirrorSyncTrabajadorSnapshot = {
  trabajador: MirrorSyncTrabajadorPayload;
  cargo: MirrorSyncCargoPayload;
};

type SaleUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_SALE_UPSERT;
  sale: MirrorSyncSalePayload;
  movVentas: MirrorSyncSaleLinePayload[];
  // Nullable (not optional) so legacy envelopes read from outbox/inbox history are
  // forced to explicitly carry the "no caja" case instead of silently omitting it.
  caja: MirrorSyncCajaPayload | null;
  impresoraFiscal: MirrorSyncImpresoraFiscalPayload | null;
  // Mismo criterio: envelopes anteriores a este cambio no traen snapshot de
  // cliente/trabajador y deben normalizar a null explicito, no fabricarse.
  cliente: MirrorSyncClientSnapshot | null;
  trabajador: MirrorSyncTrabajadorSnapshot | null;
};

type CajaUpsertEnvelope = MirrorEnvelopeBase & {
  eventType: typeof MIRROR_SYNC_EVENT_CAJA_UPSERT;
  caja: MirrorSyncCajaPayload;
  impresoraFiscal: MirrorSyncImpresoraFiscalPayload;
};

type MirrorSyncEnvelope =
  | InventoryUpsertEnvelope
  | InventoryDeleteEnvelope
  | CatalogUpsertEnvelope
  | CatalogDeleteEnvelope
  | ClientUpsertEnvelope
  | WorkerUpsertEnvelope
  | RateUpsertEnvelope
  | SaleUpsertEnvelope
  | CajaUpsertEnvelope;

type CatalogSnapshotRow = {
  Codigo: string | number;
  Nombre?: string | null;
  Status?: number | null;
  PorcentajeImpuesto?: Prisma.Decimal | null;
};

type RateSnapshotRow = {
  ID: bigint | number | string;
  Fecha: Date | string;
  Valor: unknown;
};

@Injectable()
export class MirrorSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MirrorSyncService.name);
  private mirrorSyncRetryTimer: ReturnType<typeof setInterval> | null = null;
  private mirrorSyncRetryStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private mirrorSyncRetryInProgress = false;
  private mirrorSyncAuthCache: MirrorSyncAuthCacheEntry | null = null;

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

  async getInventorySnapshotBatch(options: {
    afterCodigoBarra?: string | null;
    take?: number;
    jobId: string;
  }) {
    const take = Math.min(Math.max(Number(options.take || 25), 1), 25);
    const afterCodigoBarra = String(options.afterCodigoBarra || "").trim();
    const items = await this.prisma.inventario.findMany({
      where: afterCodigoBarra
        ? {
            CodigoBarra: {
              gt: afterCodigoBarra,
            },
          }
        : undefined,
      include: inventoryInclude,
      orderBy: { CodigoBarra: "asc" },
      take,
    });

    return {
      items: items.map((item) => ({
        ...this.buildInventoryUpsertEnvelope(item),
        globalId: `${options.jobId}-INVENTORY-${item.CodigoBarra}`,
      })),
      lastCodigoBarra: items.at(-1)?.CodigoBarra ?? afterCodigoBarra,
      completed: items.length < take,
    };
  }

  async importInventorySnapshotBatch(rawItems: unknown) {
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 25) {
      throw new BadRequestException("El lote masivo debe contener entre 1 y 25 articulos.");
    }

    const results = [];
    for (const item of rawItems) {
      results.push(await this.importMirrorPayload(item));
    }

    return {
      processed: results.length,
      imported: results.filter((item) => item.imported).length,
      results,
    };
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

  async enqueueClienteUpsert(codigo: string) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.enqueueClienteUpsertTx(tx, codigo);
    });
  }

  async enqueueClienteUpsertTx(
    tx: MirrorSyncTransactionClient,
    codigo: string,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const normalizedCodigo = this.normalizeCode(codigo);
    if (!normalizedCodigo) {
      return;
    }

    const cliente = await tx.clientes.findUnique({
      where: { Codigo: normalizedCodigo },
      include: {
        tipoCliente: true,
        contribuyenteTipo: true,
      },
    });

    if (!cliente) {
      return;
    }

    await this.recordPendingEnvelope(tx, this.buildClienteUpsertEnvelope(cliente));
  }

  async enqueueTrabajadorUpsert(cedula: string) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.enqueueTrabajadorUpsertTx(tx, cedula);
    });
  }

  async enqueueTrabajadorUpsertTx(
    tx: MirrorSyncTransactionClient,
    cedula: string,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const normalizedCedula = this.normalizeCode(cedula);
    if (!normalizedCedula) {
      return;
    }

    const trabajador = await tx.trabajadores.findUnique({
      where: { Cedula: normalizedCedula },
      include: {
        cargoRef: true,
      },
    });

    if (!trabajador) {
      return;
    }

    await this.recordPendingEnvelope(tx, this.buildTrabajadorUpsertEnvelope(trabajador));
  }

  async enqueueRateUpsertTx(
    tx: MirrorSyncTransactionClient,
    rateTable: MirrorRateTable,
    row: RateSnapshotRow | null | undefined,
  ) {
    if (!this.isMirrorSyncEnabled() || !row) {
      return;
    }

    await this.recordPendingEnvelope(tx, this.buildRateUpsertEnvelope(rateTable, row));
  }

  async enqueueVentaUpsertTx(
    tx: MirrorSyncTransactionClient,
    numeroFactura: bigint | number | string,
    serie: string,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const normalizedSerie = this.normalizeCode(serie);
    const normalizedNumero = this.normalizeBigIntString(
      numeroFactura,
      "Numero de factura espejo invalido.",
    );

    const venta = await tx.ventas.findUnique({
      where: {
        NumeroFactura_Serie: {
          NumeroFactura: BigInt(normalizedNumero),
          Serie: normalizedSerie,
        },
      },
      include: {
        movVentas: {
          orderBy: {
            Item: "asc",
          },
        },
        clienteRef: {
          include: {
            tipoCliente: true,
            contribuyenteTipo: true,
          },
        },
        trabajadorRef: {
          include: {
            cargoRef: true,
          },
        },
      },
    });

    if (!venta) {
      return;
    }

    const caja = await tx.cajas.findUnique({
      where: { Serie: venta.Serie },
      include: { impresoraFiscal: true },
    });

    if (!caja) {
      throw new BadRequestException(
        `No se puede sincronizar la venta ${venta.Serie}-${venta.NumeroFactura.toString()}: la caja ${venta.Serie} no existe localmente.`,
      );
    }

    await this.recordPendingEnvelope(tx, this.buildSaleUpsertEnvelope(venta, caja));
  }

  async enqueueCajaUpsertTx(
    tx: MirrorSyncTransactionClient,
    serie: string,
  ) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    const normalizedSerie = this.normalizeCode(serie);
    if (!normalizedSerie) {
      return;
    }

    const caja = await tx.cajas.findUnique({
      where: { Serie: normalizedSerie },
      include: { impresoraFiscal: true },
    });

    if (!caja) {
      return;
    }

    await this.recordPendingEnvelope(tx, this.buildCajaUpsertEnvelope(caja));
  }

  async enqueueCajaUpsert(serie: string) {
    if (!this.isMirrorSyncEnabled()) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.enqueueCajaUpsertTx(tx, serie);
    });
  }

  async backfillCajaUpserts() {
    await this.ensureMirrorSyncSchema();

    if (!this.isMirrorSyncEnabled()) {
      return {
        enabled: false,
        found: 0,
        queued: 0,
        skipped: 0,
      };
    }

    const cajas = await this.prisma.cajas.findMany({
      select: { Serie: true },
      orderBy: { Serie: "asc" },
    });

    let queued = 0;
    let skipped = 0;

    for (const item of cajas) {
      const normalizedSerie = this.normalizeCode(item.Serie);
      if (!normalizedSerie) {
        skipped += 1;
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await this.enqueueCajaUpsertTx(tx, normalizedSerie);
      });
      queued += 1;
    }

    return {
      enabled: true,
      found: cajas.length,
      queued,
      skipped,
    };
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

    const remaining = await this.countPendingOutboxRows();

    return {
      enabled: true,
      processed: rows.length,
      sent,
      pending,
      remaining,
    };
  }

  async importMirrorPayload(body: unknown) {
    await this.ensureMirrorSyncSchema();
    const payload = this.normalizeEnvelope(body);

    const existingInbox = await this.getInboxRow(this.prisma, payload.globalId);
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

    // Recorded as its own statement, outside the apply transaction below, so a
    // rollback of the apply never erases the fact that this envelope was received:
    // markInboxError() (in the catch block) always has a row to update into ERROR.
    await this.upsertInboxRow(this.prisma, payload, MIRROR_SYNC_STATUS_RECEIVED);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (payload.eventType === MIRROR_SYNC_EVENT_INVENTORY_UPSERT) {
            await this.applyInventoryUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_INVENTORY_DELETE) {
            await this.applyInventoryDeleteEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_CATALOG_UPSERT) {
            await this.applyCatalogUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_CATALOG_DELETE) {
            await this.applyCatalogDeleteEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_CLIENT_UPSERT) {
            await this.applyClienteUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_WORKER_UPSERT) {
            await this.applyTrabajadorUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_RATE_UPSERT) {
            await this.applyRateUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_CAJA_UPSERT) {
            await this.applyCajaUpsertEnvelope(tx, payload);
          } else if (payload.eventType === MIRROR_SYNC_EVENT_SALE_UPSERT) {
            await this.applySaleUpsertEnvelope(tx, payload);
          } else {
            throw new BadRequestException("Tipo de evento espejo no soportado.");
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await this.updateInboxRowStatus(this.prisma, payload.globalId, MIRROR_SYNC_STATUS_APPLIED, null);

      return {
        imported: true,
        status: MIRROR_SYNC_STATUS_APPLIED,
        globalId: payload.globalId,
        entityType: payload.entityType,
        entityKey: payload.entityKey,
      };
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
      const limit = this.getMirrorSyncRetryLimit();
      const maxBatches = this.getMirrorSyncRetryMaxBatches();
      let processed = 0;
      let sent = 0;
      let pending = 0;
      let remaining = 0;
      let batches = 0;

      while (batches < maxBatches) {
        const summary = await this.pushPendingMirrorSync({ limit });
        processed += summary.processed;
        sent += summary.sent;
        pending += summary.pending;
        remaining = summary.remaining ?? 0;
        batches += 1;

        if (summary.processed === 0 || remaining === 0) {
          break;
        }

        if (summary.sent === 0 && summary.pending > 0) {
          break;
        }

        if (summary.processed < limit) {
          break;
        }
      }

      if (processed > 0) {
        this.logger.log(
          `Replica espejo (${reason}): lotes=${batches}, procesados=${processed}, enviados=${sent}, reintentados=${pending}, restantes=${remaining}.`,
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

  private buildClienteSnapshot(cliente: ClienteWithRelations): MirrorSyncClientSnapshot {
    const entityKey = this.normalizeCode(cliente.Codigo);
    return {
      cliente: {
        codigo: entityKey,
        nombre: cliente.Nombre,
        fechaIngreso: cliente.FechaIngreso.toISOString(),
        telefono: cliente.Telefono ?? "",
        direccion: cliente.Direccion ?? "",
        status: cliente.Status,
        tipo: cliente.Tipo,
        tipoContribuyente: cliente.TipoContribuyente,
      },
      tipoCliente: {
        codigo: cliente.tipoCliente.Codigo,
        descripcion: cliente.tipoCliente.Descripcion ?? null,
        status: cliente.tipoCliente.Status ?? null,
      },
      tipoContribuyente: {
        codigo: cliente.contribuyenteTipo.Codigo,
        descripcion: cliente.contribuyenteTipo.Descripcion ?? null,
        status: cliente.contribuyenteTipo.Status ?? null,
      },
    };
  }

  private buildClienteUpsertEnvelope(cliente: ClienteWithRelations): ClientUpsertEnvelope {
    const entityKey = this.normalizeCode(cliente.Codigo);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId("CLIENTES", entityKey),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: "CLIENTES",
      entityKey,
      eventType: MIRROR_SYNC_EVENT_CLIENT_UPSERT,
      ...this.buildClienteSnapshot(cliente),
    };
  }

  private buildTrabajadorSnapshot(trabajador: TrabajadorWithRelations): MirrorSyncTrabajadorSnapshot {
    const entityKey = this.normalizeCode(trabajador.Cedula);
    return {
      trabajador: {
        cedula: entityKey,
        codigo: trabajador.Codigo,
        nombre: trabajador.Nombre,
        cargo: trabajador.Cargo,
        fechaIngreso: trabajador.FechaIngreso.toISOString(),
        fechaNacimiento: trabajador.FechaNacimiento?.toISOString() ?? null,
        direccion: trabajador.Direccion ?? null,
        telefono: trabajador.Telefono ?? null,
        celular: trabajador.Celular ?? null,
        status: trabajador.Status,
        marcajeInterDiario: Boolean(trabajador.MarcajeInterDiario),
        indUsarCarnet: Number(trabajador.IndUsarCarnet ?? 0),
      },
      cargo: {
        codigo: trabajador.cargoRef.Codigo,
        nombre: trabajador.cargoRef.Nombre ?? null,
        status: trabajador.cargoRef.Status ?? null,
      },
    };
  }

  private buildTrabajadorUpsertEnvelope(trabajador: TrabajadorWithRelations): WorkerUpsertEnvelope {
    const entityKey = this.normalizeCode(trabajador.Cedula);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId("TRABAJADORES", entityKey),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: "TRABAJADORES",
      entityKey,
      eventType: MIRROR_SYNC_EVENT_WORKER_UPSERT,
      ...this.buildTrabajadorSnapshot(trabajador),
    };
  }

  private buildRateUpsertEnvelope(
    rateTable: MirrorRateTable,
    row: RateSnapshotRow,
  ): RateUpsertEnvelope {
    const entityKey = this.normalizeBigIntString(row.ID, "ID de tasa espejo invalido.");
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId(rateTable, entityKey),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: rateTable,
      entityKey,
      eventType: MIRROR_SYNC_EVENT_RATE_UPSERT,
      rateTable,
      rate: {
        id: entityKey,
        fecha: this.toIsoString(row.Fecha),
        valor: this.toDecimalString(row.Valor),
      },
    };
  }

  private buildCajaPayload(caja: CajaWithImpresora): MirrorSyncCajaPayload {
    return {
      serie: caja.Serie,
      numero: caja.Numero,
      fondoCaja: this.toDecimalString(caja.FondoCaja),
      tipoListaPrecio: caja.TipoListaPrecio,
      tipoVenta: caja.TipoVenta,
      tipoReporte: caja.TipoReporte,
      ultimaFactura: caja.UltimaFactura.toString(),
      ultimaDevolucion: caja.UltimaDevolucion.toString(),
      permiteDescuento: caja.PermiteDescuento,
      permiteFacturasExentas: caja.PermiteFacturasExentas,
      permiteAlternarListas: caja.PermiteAlternarListas,
      cambiarPrecios: caja.CambiarPrecios,
      requerirAutorizacion: caja.RequerirAutorizacion,
      idImpresoraFiscal: caja.IdImpresoraFiscal,
      nombreImpresora: caja.NombreImpresora ?? null,
      numeroCopias: caja.NumeroCopias ?? null,
      incluirIGTF: caja.IncluirIGTF ?? null,
    };
  }

  private buildImpresoraFiscalPayload(
    impresoraFiscal: CajaWithImpresora["impresoraFiscal"],
  ): MirrorSyncImpresoraFiscalPayload {
    return {
      id: impresoraFiscal.ID,
      nombreImpresora: impresoraFiscal.NombreImpresora ?? null,
      status: impresoraFiscal.Status ?? null,
      idProcesoImpresion: impresoraFiscal.IdProcesoImpresion ?? null,
      montoMaximoDiario:
        impresoraFiscal.MontoMaximoDiario == null ? null : this.toDecimalString(impresoraFiscal.MontoMaximoDiario),
      incluyeIGTF: Boolean(impresoraFiscal.IncluyeIGTF),
    };
  }

  private buildCajaUpsertEnvelope(caja: CajaWithImpresora): CajaUpsertEnvelope {
    const entityKey = this.normalizeCode(caja.Serie);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId("CAJAS", entityKey),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: "CAJAS",
      entityKey,
      eventType: MIRROR_SYNC_EVENT_CAJA_UPSERT,
      caja: this.buildCajaPayload(caja),
      impresoraFiscal: this.buildImpresoraFiscalPayload(caja.impresoraFiscal),
    };
  }

  private buildSaleUpsertEnvelope(venta: VentaWithRelations, caja: CajaWithImpresora): SaleUpsertEnvelope {
    const entityKey = this.buildSaleEntityKey(venta.NumeroFactura, venta.Serie);
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.buildGlobalId("VENTAS", entityKey),
      sourceDatabase: this.getCurrentDatabaseName(),
      entityType: "VENTAS",
      entityKey,
      eventType: MIRROR_SYNC_EVENT_SALE_UPSERT,
      caja: this.buildCajaPayload(caja),
      impresoraFiscal: this.buildImpresoraFiscalPayload(caja.impresoraFiscal),
      cliente: this.buildClienteSnapshot(venta.clienteRef),
      trabajador: this.buildTrabajadorSnapshot(venta.trabajadorRef),
      sale: {
        numeroFactura: venta.NumeroFactura.toString(),
        serie: venta.Serie,
        fecha: venta.Fecha.toISOString(),
        vendedor: venta.Vendedor,
        cliente: venta.Cliente,
        tipoVenta: venta.TipoVenta,
        formaPago: venta.FormaPago,
        diasCredito: venta.DiasCredito,
        totalMercancia: this.toDecimalString(venta.TotalMercancia),
        totalDescuento: this.toDecimalString(venta.TotalDescuento),
        totalImpuesto: this.toDecimalString(venta.TotalImpuesto),
        totalCosto: this.toDecimalString(venta.TotalCosto),
        interContable: venta.InterContable,
        usuario: venta.Usuario,
        status: venta.Status,
        numeroOrden: venta.NumeroOrden.toString(),
        totalPago: this.toDecimalString(venta.TotalPago),
        totalDolares: this.toOptionalDecimalString(venta.TotalDolares),
        tasaCambio: this.toOptionalDecimalString(venta.TasaCambio),
        estacion: venta.Estacion ?? null,
        totalDolaresE: this.toOptionalDecimalString(venta.TotalDolaresE),
        tasaIGTF: this.toOptionalDecimalString(venta.TasaIGTF),
        montoIGTF: this.toOptionalDecimalString(venta.MontoIGTF),
        baseImponibleIGTF: this.toOptionalDecimalString(venta.BaseImponibleIGTF),
      },
      movVentas: venta.movVentas
        .slice()
        .sort((left, right) => left.Item - right.Item)
        .map((item) => ({
          numeroFactura: item.NumeroFactura.toString(),
          serie: item.Serie,
          hora: item.Hora.toISOString(),
          tipoLista: item.TipoLista,
          codigoBarra: item.CodigoBarra,
          precio: this.toDecimalString(item.Precio),
          precioLista: this.toDecimalString(item.PrecioLista),
          costo: this.toDecimalString(item.Costo),
          impuesto: this.toDecimalString(item.Impuesto),
          porcentajeImpuesto: this.toDecimalString(item.PorcentajeImpuesto),
          cantidad: this.toDecimalString(item.Cantidad),
          cantidadDevuelta: this.toDecimalString(item.CantidadDevuelta),
          item: item.Item,
          porcentajeDescuento: this.toDecimalString(item.PorcentajeDescuento),
          precioDetal: this.toDecimalString(item.PrecioDetal),
          regla: item.Regla,
          idRegla: item.IDRegla,
        })),
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
        order by "CreatedAt" asc, "GlobalId" asc
        limit $2
      `,
      MIRROR_SYNC_STATUS_PENDING,
      limit,
    );
  }

  private async countPendingOutboxRows() {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        select count(*)::bigint as total
        from dbo."MIRROR_SYNC_OUTBOX"
        where "Status" = $1
      `,
      MIRROR_SYNC_STATUS_PENDING,
    );

    const raw = rows[0]?.total ?? 0;
    return typeof raw === "bigint" ? Number(raw) : Number(raw || 0);
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

  private async applyClienteSnapshot(
    tx: MirrorSyncTransactionClient,
    snapshot: MirrorSyncClientSnapshot,
  ) {
    await tx.tiposCliente.upsert({
      where: { Codigo: snapshot.tipoCliente.codigo },
      create: {
        Codigo: snapshot.tipoCliente.codigo,
        Descripcion: snapshot.tipoCliente.descripcion ?? null,
        Status: snapshot.tipoCliente.status ?? 1,
      },
      update: {
        Descripcion: snapshot.tipoCliente.descripcion ?? null,
        Status: snapshot.tipoCliente.status ?? 1,
      },
    });

    await tx.tiposContribuyente.upsert({
      where: { Codigo: snapshot.tipoContribuyente.codigo },
      create: {
        Codigo: snapshot.tipoContribuyente.codigo,
        Descripcion: snapshot.tipoContribuyente.descripcion ?? null,
        Status: snapshot.tipoContribuyente.status ?? 1,
      },
      update: {
        Descripcion: snapshot.tipoContribuyente.descripcion ?? null,
        Status: snapshot.tipoContribuyente.status ?? 1,
      },
    });

    const cliente = snapshot.cliente;
    await tx.clientes.upsert({
      where: { Codigo: cliente.codigo },
      create: {
        Codigo: cliente.codigo,
        Nombre: cliente.nombre,
        FechaIngreso: new Date(cliente.fechaIngreso),
        Telefono: cliente.telefono,
        Direccion: cliente.direccion,
        Status: cliente.status,
        Tipo: cliente.tipo,
        TipoContribuyente: cliente.tipoContribuyente,
      },
      update: {
        Nombre: cliente.nombre,
        FechaIngreso: new Date(cliente.fechaIngreso),
        Telefono: cliente.telefono,
        Direccion: cliente.direccion,
        Status: cliente.status,
        Tipo: cliente.tipo,
        TipoContribuyente: cliente.tipoContribuyente,
      },
    });
  }

  private async applyClienteUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: ClientUpsertEnvelope,
  ) {
    await this.applyClienteSnapshot(tx, payload);
  }

  private async applyTrabajadorSnapshot(
    tx: MirrorSyncTransactionClient,
    snapshot: MirrorSyncTrabajadorSnapshot,
  ) {
    await tx.cargos.upsert({
      where: { Codigo: snapshot.cargo.codigo },
      create: {
        Codigo: snapshot.cargo.codigo,
        Nombre: snapshot.cargo.nombre ?? snapshot.cargo.codigo,
        Status: snapshot.cargo.status ?? 1,
      },
      update: {
        Nombre: snapshot.cargo.nombre ?? snapshot.cargo.codigo,
        Status: snapshot.cargo.status ?? 1,
      },
    });

    const trabajador = snapshot.trabajador;
    // schema.prisma declara FechaNacimiento/Direccion/Telefono/Celular nullable, pero
    // el DDL real de algunos destinos (confirmado contra rocky_tienda_001_vps) los
    // tiene NOT NULL. No son campos obligatorios de negocio, asi que si el origen
    // los trae vacios se escribe un valor neutro en destino en vez de fallar.
    const fechaNacimientoDestino = trabajador.fechaNacimiento
      ? new Date(trabajador.fechaNacimiento)
      : new Date(0);
    const direccionDestino = trabajador.direccion ?? "";
    const telefonoDestino = trabajador.telefono ?? "";
    const celularDestino = trabajador.celular ?? "";

    await tx.trabajadores.upsert({
      where: { Cedula: trabajador.cedula },
      create: {
        Cedula: trabajador.cedula,
        Codigo: trabajador.codigo,
        Nombre: trabajador.nombre,
        Cargo: trabajador.cargo,
        FechaIngreso: new Date(trabajador.fechaIngreso),
        FechaNacimiento: fechaNacimientoDestino,
        Direccion: direccionDestino,
        Telefono: telefonoDestino,
        Celular: celularDestino,
        Status: trabajador.status,
        MarcajeInterDiario: trabajador.marcajeInterDiario,
        IndUsarCarnet: trabajador.indUsarCarnet,
      },
      update: {
        Codigo: trabajador.codigo,
        Nombre: trabajador.nombre,
        Cargo: trabajador.cargo,
        FechaIngreso: new Date(trabajador.fechaIngreso),
        FechaNacimiento: fechaNacimientoDestino,
        Direccion: direccionDestino,
        Telefono: telefonoDestino,
        Celular: celularDestino,
        Status: trabajador.status,
        MarcajeInterDiario: trabajador.marcajeInterDiario,
        IndUsarCarnet: trabajador.indUsarCarnet,
      },
    });
  }

  private async applyTrabajadorUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: WorkerUpsertEnvelope,
  ) {
    await this.applyTrabajadorSnapshot(tx, payload);
  }

  private async applyRateUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: RateUpsertEnvelope,
  ) {
    const id = BigInt(payload.rate.id);
    const data = {
      ID: id,
      Fecha: new Date(payload.rate.fecha),
      Valor: payload.rate.valor,
    };

    if (payload.rateTable === "TASA_CAMBIO") {
      await tx.tasaCambio.upsert({
        where: { ID: id },
        create: data,
        update: {
          Fecha: data.Fecha,
          Valor: data.Valor,
        },
      });
    } else {
      await tx.tasaCambioM.upsert({
        where: { ID: id },
        create: data,
        update: {
          Fecha: data.Fecha,
          Valor: data.Valor,
        },
      });
    }

    await this.recalculateInventoryPricesFromRatesTx(tx);
  }

  private async applyImpresoraFiscalUpsert(
    tx: MirrorSyncTransactionClient,
    impresora: MirrorSyncImpresoraFiscalPayload,
  ) {
    // Written with raw SQL (matching prisma.service.ts / impresoras.service.ts) rather
    // than the typed Prisma client: IMPRESORAFISCAL.ID is both PK and its own self-FK,
    // which the rest of the codebase already routes around via raw SQL for this table.
    await tx.$executeRawUnsafe(
      `
        insert into dbo."IMPRESORAFISCAL"
          ("ID", "NombreImpresora", "Status", "IdProcesoImpresion", "MontoMaximoDiario", "IncluyeIGTF")
        values ($1, $2, $3, $4, $5::numeric, $6)
        on conflict ("ID") do update set
          "NombreImpresora" = excluded."NombreImpresora",
          "Status" = excluded."Status",
          "IdProcesoImpresion" = excluded."IdProcesoImpresion",
          "MontoMaximoDiario" = excluded."MontoMaximoDiario",
          "IncluyeIGTF" = excluded."IncluyeIGTF"
      `,
      impresora.id,
      impresora.nombreImpresora,
      impresora.status,
      impresora.idProcesoImpresion,
      impresora.montoMaximoDiario,
      impresora.incluyeIGTF,
    );
  }

  private async applyCajaUpsert(
    tx: MirrorSyncTransactionClient,
    caja: MirrorSyncCajaPayload,
  ) {
    await tx.cajas.upsert({
      where: { Serie: caja.serie },
      create: {
        Serie: caja.serie,
        Numero: caja.numero,
        FondoCaja: caja.fondoCaja,
        TipoListaPrecio: caja.tipoListaPrecio,
        TipoVenta: caja.tipoVenta,
        TipoReporte: caja.tipoReporte,
        UltimaFactura: BigInt(caja.ultimaFactura),
        UltimaDevolucion: BigInt(caja.ultimaDevolucion),
        PermiteDescuento: caja.permiteDescuento,
        PermiteFacturasExentas: caja.permiteFacturasExentas,
        PermiteAlternarListas: caja.permiteAlternarListas,
        CambiarPrecios: caja.cambiarPrecios,
        RequerirAutorizacion: caja.requerirAutorizacion,
        IdImpresoraFiscal: caja.idImpresoraFiscal,
        NombreImpresora: caja.nombreImpresora,
        NumeroCopias: caja.numeroCopias,
        IncluirIGTF: caja.incluirIGTF,
      },
      update: {
        Numero: caja.numero,
        FondoCaja: caja.fondoCaja,
        TipoListaPrecio: caja.tipoListaPrecio,
        TipoVenta: caja.tipoVenta,
        TipoReporte: caja.tipoReporte,
        UltimaFactura: BigInt(caja.ultimaFactura),
        UltimaDevolucion: BigInt(caja.ultimaDevolucion),
        PermiteDescuento: caja.permiteDescuento,
        PermiteFacturasExentas: caja.permiteFacturasExentas,
        PermiteAlternarListas: caja.permiteAlternarListas,
        CambiarPrecios: caja.cambiarPrecios,
        RequerirAutorizacion: caja.requerirAutorizacion,
        IdImpresoraFiscal: caja.idImpresoraFiscal,
        NombreImpresora: caja.nombreImpresora,
        NumeroCopias: caja.numeroCopias,
        IncluirIGTF: caja.incluirIGTF,
      },
    });
  }

  private async applyCajaUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: CajaUpsertEnvelope,
  ) {
    await this.applyImpresoraFiscalUpsert(tx, payload.impresoraFiscal);
    await this.applyCajaUpsert(tx, payload.caja);
  }

  // No sincronizamos USUARIOS (decision de negocio: solo importan Cliente,
  // Trabajador/Vendedor, articulos y totales/caja de una venta replicada). Si el
  // usuario original no existe en destino, se remapea al usuario semilla
  // configurado (MIRROR_SYNC_FALLBACK_USUARIO, default "Caja"). Nunca se crea un
  // usuario automaticamente: si el fallback tampoco existe, se falla explicito.
  private async resolveSaleUsuario(tx: MirrorSyncTransactionClient, usuarioOriginal: string): Promise<string> {
    const existente = await tx.usuarios.findUnique({
      where: { CodUsuario: usuarioOriginal },
      select: { CodUsuario: true },
    });
    if (existente) {
      return existente.CodUsuario;
    }

    const fallback = this.configService.get<string>("MIRROR_SYNC_FALLBACK_USUARIO", "Caja");
    const fallbackExiste = await tx.usuarios.findUnique({
      where: { CodUsuario: fallback },
      select: { CodUsuario: true },
    });
    if (!fallbackExiste) {
      throw new BadRequestException(
        `Usuario espejo "${usuarioOriginal}" no existe en destino y el fallback configurado ` +
          `"${fallback}" (MIRROR_SYNC_FALLBACK_USUARIO) tampoco existe. No se crean usuarios automaticamente.`,
      );
    }

    return fallbackExiste.CodUsuario;
  }

  private async applySaleUpsertEnvelope(
    tx: MirrorSyncTransactionClient,
    payload: SaleUpsertEnvelope,
  ) {
    // CAJAS (and its IMPRESORAFISCAL dependency) must exist before VENTAS.Serie -> CAJAS.Serie
    // can be satisfied. Legacy envelopes captured before this field existed carry caja=null;
    // if the destination doesn't already have that CAJAS row, ventas.upsert below will throw
    // P2003 and importMirrorPayload's caller records a durable ERROR instead of losing it.
    if (payload.caja) {
      if (payload.impresoraFiscal) {
        await this.applyImpresoraFiscalUpsert(tx, payload.impresoraFiscal);
      }
      await this.applyCajaUpsert(tx, payload.caja);
    }

    // Igual criterio que CAJAS: CLIENTES/TRABAJADORES deben existir antes de VENTAS
    // por sus FKs. Envelopes legacy sin snapshot (cliente/trabajador=null) no se
    // inventan aqui — si el destino no los tiene ya, el upsert de VENTAS mas abajo
    // fallara por FK y quedara como ERROR visible, tal como se decidio.
    if (payload.cliente) {
      await this.applyClienteSnapshot(tx, payload.cliente);
    }
    if (payload.trabajador) {
      await this.applyTrabajadorSnapshot(tx, payload.trabajador);
    }

    const sale = payload.sale;
    const numeroFactura = BigInt(sale.numeroFactura);
    const numeroOrden = BigInt(sale.numeroOrden);
    const usuarioDestino = await this.resolveSaleUsuario(tx, sale.usuario);

    await tx.ventas.upsert({
      where: {
        NumeroFactura_Serie: {
          NumeroFactura: numeroFactura,
          Serie: sale.serie,
        },
      },
      create: {
        NumeroFactura: numeroFactura,
        Serie: sale.serie,
        Fecha: new Date(sale.fecha),
        Vendedor: sale.vendedor,
        Cliente: sale.cliente,
        TipoVenta: sale.tipoVenta,
        FormaPago: sale.formaPago,
        DiasCredito: sale.diasCredito,
        TotalMercancia: sale.totalMercancia,
        TotalDescuento: sale.totalDescuento,
        TotalImpuesto: sale.totalImpuesto,
        TotalCosto: sale.totalCosto,
        InterContable: sale.interContable,
        Usuario: usuarioDestino,
        Status: sale.status,
        NumeroOrden: numeroOrden,
        TotalPago: sale.totalPago,
        TotalDolares: sale.totalDolares,
        TasaCambio: sale.tasaCambio,
        Estacion: sale.estacion,
        TotalDolaresE: sale.totalDolaresE,
        TasaIGTF: sale.tasaIGTF,
        MontoIGTF: sale.montoIGTF,
        BaseImponibleIGTF: sale.baseImponibleIGTF,
      },
      update: {
        Fecha: new Date(sale.fecha),
        Vendedor: sale.vendedor,
        Cliente: sale.cliente,
        TipoVenta: sale.tipoVenta,
        FormaPago: sale.formaPago,
        DiasCredito: sale.diasCredito,
        TotalMercancia: sale.totalMercancia,
        TotalDescuento: sale.totalDescuento,
        TotalImpuesto: sale.totalImpuesto,
        TotalCosto: sale.totalCosto,
        InterContable: sale.interContable,
        Usuario: usuarioDestino,
        Status: sale.status,
        NumeroOrden: numeroOrden,
        TotalPago: sale.totalPago,
        TotalDolares: sale.totalDolares,
        TasaCambio: sale.tasaCambio,
        Estacion: sale.estacion,
        TotalDolaresE: sale.totalDolaresE,
        TasaIGTF: sale.tasaIGTF,
        MontoIGTF: sale.montoIGTF,
        BaseImponibleIGTF: sale.baseImponibleIGTF,
      },
    });

    const items = payload.movVentas.slice().sort((left, right) => left.item - right.item);
    if (items.length > 0) {
      await tx.movVentas.deleteMany({
        where: {
          NumeroFactura: numeroFactura,
          Serie: sale.serie,
          Item: {
            notIn: items.map((item) => item.item),
          },
        },
      });
    }

    for (const item of items) {
      await tx.movVentas.upsert({
        where: {
          NumeroFactura_Serie_Item: {
            NumeroFactura: numeroFactura,
            Serie: sale.serie,
            Item: item.item,
          },
        },
        create: {
          NumeroFactura: numeroFactura,
          Serie: sale.serie,
          Hora: new Date(item.hora),
          TipoLista: item.tipoLista,
          CodigoBarra: item.codigoBarra,
          Precio: item.precio,
          PrecioLista: item.precioLista,
          Costo: item.costo,
          Impuesto: item.impuesto,
          PorcentajeImpuesto: item.porcentajeImpuesto,
          Cantidad: item.cantidad,
          CantidadDevuelta: item.cantidadDevuelta,
          Item: item.item,
          PorcentajeDescuento: item.porcentajeDescuento,
          PrecioDetal: item.precioDetal,
          Regla: item.regla,
          IDRegla: item.idRegla,
        },
        update: {
          Hora: new Date(item.hora),
          TipoLista: item.tipoLista,
          CodigoBarra: item.codigoBarra,
          Precio: item.precio,
          PrecioLista: item.precioLista,
          Costo: item.costo,
          Impuesto: item.impuesto,
          PorcentajeImpuesto: item.porcentajeImpuesto,
          Cantidad: item.cantidad,
          CantidadDevuelta: item.cantidadDevuelta,
          PorcentajeDescuento: item.porcentajeDescuento,
          PrecioDetal: item.precioDetal,
          Regla: item.regla,
          IDRegla: item.idRegla,
        },
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

  private async recalculateInventoryPricesFromRatesTx(tx: MirrorSyncTransactionClient) {
    const [detalle, mayor] = await Promise.all([
      tx.tasaCambio.findFirst({
        orderBy: {
          ID: "desc",
        },
      }),
      tx.tasaCambioM.findFirst({
        orderBy: {
          ID: "desc",
        },
      }),
    ]);

    if (!detalle || !mayor) {
      return;
    }

    await tx.$executeRawUnsafe(
      `
        UPDATE dbo."INVENTARIO"
        SET
          "PrecioDetal" = ROUND(COALESCE("CostoInicial", 0)::numeric * $1::numeric, 2),
          "PrecioMayor" = ROUND(COALESCE("CostoPromedio", 0)::numeric * $2::numeric, 2),
          "PrecioAfiliado" = ROUND(COALESCE("UltimoCosto", 0)::numeric * $1::numeric, 2),
          "UltimaActualizacion" = $3::timestamp
      `,
      this.toDecimalString(detalle.Valor),
      this.toDecimalString(mayor.Valor),
      this.getMostRecentDateValue([detalle.Fecha, mayor.Fecha]),
    );
  }

  private async postMirrorSyncPackage(baseUrl: string, payload: MirrorSyncEnvelope) {
    let token = await this.getRemoteMirrorAuthToken(baseUrl);
    let response = await this.sendMirrorSyncPackage(baseUrl, token, payload);

    if (response.status === 401 || response.status === 403) {
      this.clearRemoteMirrorAuthToken(baseUrl);
      token = await this.getRemoteMirrorAuthToken(baseUrl, true);
      response = await this.sendMirrorSyncPackage(baseUrl, token, payload);
    }

    if (!response.ok) {
      const body = await this.readResponseBody(response);
      throw new Error(body || `El VPS respondio con ${response.status}.`);
    }

    return response.json().catch(() => null);
  }

  private async sendMirrorSyncPackage(baseUrl: string, token: string, payload: MirrorSyncEnvelope) {
    return fetch(`${baseUrl}/api/mirror-sync/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  private async getRemoteMirrorAuthToken(baseUrl: string, forceRefresh = false) {
    const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!forceRefresh && this.mirrorSyncAuthCache?.baseUrl === normalizedBaseUrl) {
      const expiresAt = this.mirrorSyncAuthCache.expiresAt;
      if (!expiresAt || expiresAt - MIRROR_SYNC_AUTH_REFRESH_BUFFER_MS > Date.now()) {
        return this.mirrorSyncAuthCache.token;
      }
    }

    const token = await this.loginRemoteMirrorNode(normalizedBaseUrl);
    this.mirrorSyncAuthCache = {
      baseUrl: normalizedBaseUrl,
      token,
      expiresAt: this.getJwtExpiration(token),
    };
    return token;
  }

  private clearRemoteMirrorAuthToken(baseUrl?: string) {
    if (!this.mirrorSyncAuthCache) {
      return;
    }

    if (!baseUrl) {
      this.mirrorSyncAuthCache = null;
      return;
    }

    const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (this.mirrorSyncAuthCache.baseUrl === normalizedBaseUrl) {
      this.mirrorSyncAuthCache = null;
    }
  }

  private getJwtExpiration(token: string) {
    try {
      const [, payloadSegment] = String(token || "").split(".");
      if (!payloadSegment) {
        return null;
      }

      const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      return typeof payload.exp === "number" ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
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

    if (eventType === MIRROR_SYNC_EVENT_CLIENT_UPSERT) {
      return this.normalizeClienteUpsertEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_WORKER_UPSERT) {
      return this.normalizeTrabajadorUpsertEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_RATE_UPSERT) {
      return this.normalizeRateUpsertEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_SALE_UPSERT) {
      return this.normalizeSaleUpsertEnvelope(raw);
    }

    if (eventType === MIRROR_SYNC_EVENT_CAJA_UPSERT) {
      return this.normalizeCajaUpsertEnvelope(raw);
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

  private normalizeClienteUpsertEnvelope(raw: Record<string, unknown>): ClientUpsertEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_CLIENT_UPSERT,
      cliente: this.normalizeClientePayload(raw.cliente),
      tipoCliente: this.normalizeClientTypePayload(raw.tipoCliente, "Tipo de cliente espejo invalido."),
      tipoContribuyente: this.normalizeClientTypePayload(
        raw.tipoContribuyente,
        "Tipo de contribuyente espejo invalido.",
      ),
    };
  }

  private normalizeTrabajadorUpsertEnvelope(raw: Record<string, unknown>): WorkerUpsertEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_WORKER_UPSERT,
      trabajador: this.normalizeTrabajadorPayload(raw.trabajador),
      cargo: this.normalizeCargoPayload(raw.cargo),
    };
  }

  private normalizeRateUpsertEnvelope(raw: Record<string, unknown>): RateUpsertEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_RATE_UPSERT,
      rateTable: this.normalizeRateTable(raw.rateTable),
      rate: this.normalizeRatePayload(raw.rate),
    };
  }

  private normalizeSaleUpsertEnvelope(raw: Record<string, unknown>): SaleUpsertEnvelope {
    const rawLines = Array.isArray(raw.movVentas) ? raw.movVentas : [];
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_SALE_UPSERT,
      sale: this.normalizeSalePayload(raw.sale),
      movVentas: rawLines.map((item, index) => this.normalizeSaleLinePayload(item, index)),
      caja: this.normalizeOptionalCajaPayload(raw.caja),
      impresoraFiscal: this.normalizeOptionalImpresoraFiscalPayload(raw.impresoraFiscal),
      cliente: this.normalizeOptionalClienteSnapshot(raw.cliente),
      trabajador: this.normalizeOptionalTrabajadorSnapshot(raw.trabajador),
    };
  }

  private normalizeOptionalClienteSnapshot(raw: unknown): MirrorSyncClientSnapshot | null {
    if (raw == null) {
      return null;
    }

    const value = this.asRecord(raw);
    return {
      cliente: this.normalizeClientePayload(value.cliente),
      tipoCliente: this.normalizeClientTypePayload(value.tipoCliente, "Tipo de cliente espejo invalido."),
      tipoContribuyente: this.normalizeClientTypePayload(
        value.tipoContribuyente,
        "Tipo de contribuyente espejo invalido.",
      ),
    };
  }

  private normalizeOptionalTrabajadorSnapshot(raw: unknown): MirrorSyncTrabajadorSnapshot | null {
    if (raw == null) {
      return null;
    }

    const value = this.asRecord(raw);
    return {
      trabajador: this.normalizeTrabajadorPayload(value.trabajador),
      cargo: this.normalizeCargoPayload(value.cargo),
    };
  }

  private normalizeCajaUpsertEnvelope(raw: Record<string, unknown>): CajaUpsertEnvelope {
    return {
      schemaVersion: MIRROR_SYNC_SCHEMA_VERSION,
      globalId: this.normalizeRequiredCode(raw.globalId, "GlobalId espejo invalido."),
      sourceDatabase: String(raw.sourceDatabase || "").trim(),
      entityType: this.normalizeRequiredCode(raw.entityType, "EntityType espejo invalido."),
      entityKey: this.normalizeRequiredCode(raw.entityKey, "EntityKey espejo invalido."),
      eventType: MIRROR_SYNC_EVENT_CAJA_UPSERT,
      caja: this.normalizeCajaPayload(raw.caja),
      impresoraFiscal: this.normalizeImpresoraFiscalPayload(raw.impresoraFiscal),
    };
  }

  private normalizeCajaPayload(raw: unknown): MirrorSyncCajaPayload {
    const value = this.asRecord(raw);
    return {
      serie: this.normalizeRequiredCode(value.serie, "Serie de caja invalida."),
      numero: this.toNonNegativeInteger(value.numero, "Numero de caja invalido."),
      fondoCaja: this.normalizeDecimalString(value.fondoCaja, "Fondo de caja invalido."),
      tipoListaPrecio: this.toNonNegativeInteger(value.tipoListaPrecio, "Tipo de lista de precio invalido."),
      tipoVenta: this.toNonNegativeInteger(value.tipoVenta, "Tipo de venta de caja invalido."),
      tipoReporte: this.toNonNegativeInteger(value.tipoReporte, "Tipo de reporte de caja invalido."),
      ultimaFactura: this.normalizeBigIntString(value.ultimaFactura, "Ultima factura de caja invalida."),
      ultimaDevolucion: this.normalizeBigIntString(value.ultimaDevolucion, "Ultima devolucion de caja invalida."),
      permiteDescuento: this.toNonNegativeInteger(value.permiteDescuento, "Permite descuento de caja invalido."),
      permiteFacturasExentas: this.toNonNegativeInteger(
        value.permiteFacturasExentas,
        "Permite facturas exentas de caja invalido.",
      ),
      permiteAlternarListas: this.toNonNegativeInteger(
        value.permiteAlternarListas,
        "Permite alternar listas de caja invalido.",
      ),
      cambiarPrecios: this.toNonNegativeInteger(value.cambiarPrecios, "Cambiar precios de caja invalido."),
      requerirAutorizacion: this.toNonNegativeInteger(
        value.requerirAutorizacion,
        "Requerir autorizacion de caja invalido.",
      ),
      idImpresoraFiscal: this.toNonNegativeInteger(value.idImpresoraFiscal, "Impresora fiscal de caja invalida."),
      nombreImpresora: value.nombreImpresora == null ? null : String(value.nombreImpresora),
      numeroCopias:
        value.numeroCopias == null ? null : this.toNonNegativeInteger(value.numeroCopias, "Numero de copias de caja invalido."),
      incluirIGTF: value.incluirIGTF == null ? null : this.toBoolean(value.incluirIGTF),
    };
  }

  private normalizeOptionalCajaPayload(raw: unknown): MirrorSyncCajaPayload | null {
    if (raw == null) {
      return null;
    }

    return this.normalizeCajaPayload(raw);
  }

  private normalizeImpresoraFiscalPayload(raw: unknown): MirrorSyncImpresoraFiscalPayload {
    const value = this.asRecord(raw);
    return {
      id: this.toNonNegativeInteger(value.id, "Identificador de impresora fiscal invalido."),
      nombreImpresora: value.nombreImpresora == null ? null : String(value.nombreImpresora),
      status: value.status == null ? null : this.normalizeSignedInteger(value.status, "Status de impresora fiscal invalido."),
      idProcesoImpresion:
        value.idProcesoImpresion == null
          ? null
          : this.toNonNegativeInteger(value.idProcesoImpresion, "Proceso de impresion fiscal invalido."),
      montoMaximoDiario:
        value.montoMaximoDiario == null
          ? null
          : this.normalizeDecimalString(value.montoMaximoDiario, "Monto maximo diario de impresora invalido."),
      incluyeIGTF: this.toBoolean(value.incluyeIGTF),
    };
  }

  private normalizeOptionalImpresoraFiscalPayload(raw: unknown): MirrorSyncImpresoraFiscalPayload | null {
    if (raw == null) {
      return null;
    }

    return this.normalizeImpresoraFiscalPayload(raw);
  }

  private normalizeClientePayload(raw: unknown): MirrorSyncClientePayload {
    const value = this.asRecord(raw);
    return {
      codigo: this.normalizeRequiredCode(value.codigo, "Codigo de cliente invalido."),
      nombre: this.normalizeRequiredString(value.nombre, "Nombre de cliente invalido."),
      fechaIngreso: this.normalizeIsoDateString(value.fechaIngreso, "Fecha de ingreso del cliente invalida."),
      telefono: this.normalizeOptionalString(value.telefono),
      direccion: this.normalizeOptionalString(value.direccion),
      status: this.normalizeSignedInteger(value.status, "Status de cliente invalido."),
      tipo: this.toNonNegativeInteger(value.tipo, "Tipo de cliente invalido."),
      tipoContribuyente: this.toNonNegativeInteger(value.tipoContribuyente, "Tipo de contribuyente invalido."),
    };
  }

  private normalizeClientTypePayload(raw: unknown, message: string): MirrorSyncClientTypePayload {
    const value = this.asRecord(raw);
    return {
      codigo: this.toNonNegativeInteger(value.codigo, message),
      descripcion: value.descripcion == null ? null : String(value.descripcion),
      status: value.status == null ? null : this.normalizeSignedInteger(value.status, message),
    };
  }

  private normalizeTrabajadorPayload(raw: unknown): MirrorSyncTrabajadorPayload {
    const value = this.asRecord(raw);
    return {
      cedula: this.normalizeRequiredCode(value.cedula, "Cedula de trabajador invalida."),
      codigo: this.toNonNegativeInteger(value.codigo, "Codigo de trabajador invalido."),
      nombre: this.normalizeRequiredString(value.nombre, "Nombre de trabajador invalido."),
      cargo: this.normalizeRequiredCode(value.cargo, "Cargo de trabajador invalido."),
      fechaIngreso: this.normalizeIsoDateString(value.fechaIngreso, "Fecha de ingreso del trabajador invalida."),
      fechaNacimiento:
        value.fechaNacimiento == null || String(value.fechaNacimiento).trim() === ""
          ? null
          : this.normalizeIsoDateString(value.fechaNacimiento, "Fecha de nacimiento del trabajador invalida."),
      direccion: value.direccion == null ? null : String(value.direccion),
      telefono: value.telefono == null ? null : String(value.telefono),
      celular: value.celular == null ? null : String(value.celular),
      status: this.normalizeSignedInteger(value.status, "Status de trabajador invalido."),
      marcajeInterDiario: this.toBoolean(value.marcajeInterDiario),
      indUsarCarnet: this.toNonNegativeInteger(value.indUsarCarnet ?? 0, "Carnet de trabajador invalido."),
    };
  }

  private normalizeCargoPayload(raw: unknown): MirrorSyncCargoPayload {
    const value = this.asRecord(raw);
    return {
      codigo: this.normalizeRequiredCode(value.codigo, "Cargo espejo invalido."),
      nombre: value.nombre == null ? null : String(value.nombre),
      status: value.status == null ? null : this.normalizeSignedInteger(value.status, "Status de cargo invalido."),
    };
  }

  private normalizeRatePayload(raw: unknown): MirrorSyncRatePayload {
    const value = this.asRecord(raw);
    return {
      id: this.normalizeBigIntString(value.id, "ID de tasa invalido."),
      fecha: this.normalizeIsoDateString(value.fecha, "Fecha de tasa invalida."),
      valor: this.normalizeDecimalString(value.valor, "Valor de tasa invalido."),
    };
  }

  private normalizeSalePayload(raw: unknown): MirrorSyncSalePayload {
    const value = this.asRecord(raw);
    return {
      numeroFactura: this.normalizeBigIntString(value.numeroFactura, "Numero de factura invalido."),
      serie: this.normalizeRequiredCode(value.serie, "Serie de venta invalida."),
      fecha: this.normalizeIsoDateString(value.fecha, "Fecha de venta invalida."),
      vendedor: this.normalizeRequiredCode(value.vendedor, "Vendedor de venta invalido."),
      cliente: this.normalizeRequiredCode(value.cliente, "Cliente de venta invalido."),
      tipoVenta: this.normalizeSignedInteger(value.tipoVenta, "Tipo de venta invalido."),
      formaPago: this.normalizeSignedInteger(value.formaPago, "Forma de pago invalida."),
      diasCredito: this.normalizeSignedInteger(value.diasCredito, "Dias de credito invalidos."),
      totalMercancia: this.normalizeDecimalString(value.totalMercancia, "Total mercancia invalido."),
      totalDescuento: this.normalizeDecimalString(value.totalDescuento, "Total descuento invalido."),
      totalImpuesto: this.normalizeDecimalString(value.totalImpuesto, "Total impuesto invalido."),
      totalCosto: this.normalizeDecimalString(value.totalCosto, "Total costo invalido."),
      interContable: this.normalizeSignedInteger(value.interContable, "Intercontable invalido."),
      usuario: this.normalizeRequiredString(value.usuario, "Usuario de venta invalido."),
      status: this.normalizeSignedInteger(value.status, "Status de venta invalido."),
      numeroOrden: this.normalizeBigIntString(value.numeroOrden, "Numero de orden invalido."),
      totalPago: this.normalizeDecimalString(value.totalPago, "Total pago invalido."),
      totalDolares: this.normalizeOptionalDecimalString(value.totalDolares),
      tasaCambio: this.normalizeOptionalDecimalString(value.tasaCambio),
      estacion: value.estacion == null ? null : String(value.estacion).trim(),
      totalDolaresE: this.normalizeOptionalDecimalString(value.totalDolaresE),
      tasaIGTF: this.normalizeOptionalDecimalString(value.tasaIGTF),
      montoIGTF: this.normalizeOptionalDecimalString(value.montoIGTF),
      baseImponibleIGTF: this.normalizeOptionalDecimalString(value.baseImponibleIGTF),
    };
  }

  private normalizeSaleLinePayload(raw: unknown, index: number): MirrorSyncSaleLinePayload {
    const value = this.asRecord(raw);
    return {
      numeroFactura: this.normalizeBigIntString(value.numeroFactura, `Numero de factura invalido en item ${index + 1}.`),
      serie: this.normalizeRequiredCode(value.serie, `Serie invalida en item ${index + 1}.`),
      hora: this.normalizeIsoDateString(value.hora, `Hora invalida en item ${index + 1}.`),
      tipoLista: this.normalizeRequiredString(value.tipoLista, `Tipo de lista invalido en item ${index + 1}.`),
      codigoBarra: this.normalizeRequiredCode(value.codigoBarra, `Codigo de barra invalido en item ${index + 1}.`),
      precio: this.normalizeDecimalString(value.precio, `Precio invalido en item ${index + 1}.`),
      precioLista: this.normalizeDecimalString(value.precioLista, `Precio lista invalido en item ${index + 1}.`),
      costo: this.normalizeDecimalString(value.costo, `Costo invalido en item ${index + 1}.`),
      impuesto: this.normalizeDecimalString(value.impuesto, `Impuesto invalido en item ${index + 1}.`),
      porcentajeImpuesto: this.normalizeDecimalString(
        value.porcentajeImpuesto,
        `Porcentaje de impuesto invalido en item ${index + 1}.`,
      ),
      cantidad: this.normalizeDecimalString(value.cantidad, `Cantidad invalida en item ${index + 1}.`),
      cantidadDevuelta: this.normalizeDecimalString(
        value.cantidadDevuelta,
        `Cantidad devuelta invalida en item ${index + 1}.`,
      ),
      item: this.toNonNegativeInteger(value.item, `Item invalido en linea ${index + 1}.`),
      porcentajeDescuento: this.normalizeDecimalString(
        value.porcentajeDescuento,
        `Porcentaje descuento invalido en item ${index + 1}.`,
      ),
      precioDetal: this.normalizeDecimalString(value.precioDetal, `Precio detal invalido en item ${index + 1}.`),
      regla: value.regla == null ? "" : String(value.regla),
      idRegla: this.normalizeSignedInteger(value.idRegla, `ID de regla invalido en item ${index + 1}.`),
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

  private normalizeRateTable(value: unknown): MirrorRateTable {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "TASA_CAMBIO" || normalized === "TASA_CAMBIO_M") {
      return normalized;
    }

    throw new BadRequestException("Tabla de tasa invalida.");
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

  private normalizeOptionalDecimalString(value: unknown) {
    if (value == null || String(value).trim() === "") {
      return null;
    }

    return this.normalizeDecimalString(value, "Decimal espejo invalido.");
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

  private normalizeBigIntString(value: unknown, message: string) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }

    try {
      return BigInt(normalized).toString();
    } catch {
      throw new BadRequestException(message);
    }
  }

  private toNonNegativeInteger(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new BadRequestException(message);
    }

    return number;
  }

  private normalizeSignedInteger(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
      throw new BadRequestException(message);
    }

    return number;
  }

  private toBoolean(value: unknown) {
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "si", "on"].includes(normalized);
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

  private toIsoString(value: Date | string) {
    const date = value instanceof Date ? value : new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Fecha espejo invalida.");
    }

    return date.toISOString();
  }

  private toDecimalString(value: unknown) {
    return new Prisma.Decimal(String(value ?? "0")).toString();
  }

  private toOptionalDecimalString(value: unknown) {
    if (value == null) {
      return null;
    }

    return this.toDecimalString(value);
  }

  private getMostRecentDateValue(values: Array<Date | string | null | undefined>) {
    const timestamps = values
      .map((value) => {
        const date = value instanceof Date ? value : value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) {
          return null;
        }

        return date;
      })
      .filter((value): value is Date => value !== null)
      .sort((left, right) => right.getTime() - left.getTime());

    return timestamps[0] ?? new Date();
  }

  private buildSaleEntityKey(numeroFactura: bigint | number | string, serie: string) {
    return `${this.normalizeCode(serie)}:${this.normalizeBigIntString(numeroFactura, "Numero de factura espejo invalido.")}`;
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
    return Math.max(
      this.readIntegerConfig("MIRROR_SYNC_AUTO_RETRY_LIMIT", DEFAULT_MIRROR_SYNC_RETRY_LIMIT),
      DEFAULT_MIRROR_SYNC_RETRY_LIMIT,
    );
  }

  private getMirrorSyncRetryMaxBatches() {
    return this.readIntegerConfig("MIRROR_SYNC_AUTO_RETRY_MAX_BATCHES", DEFAULT_MIRROR_SYNC_RETRY_MAX_BATCHES);
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

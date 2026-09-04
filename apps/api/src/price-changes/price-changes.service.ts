import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { UserView } from "../users/user-view.util";
import { PrismaService } from "../prisma/prisma.service";
import { fetchWithTimeout } from "../shared/fetch-with-timeout.util";
import { CreatePriceChangeBatchDto } from "./dto/create-price-change-batch.dto";
import { PreviewPriceChangeBatchDto } from "./dto/preview-price-change-batch.dto";
import { PRICE_CHANGE_MODE_FULL_INVENTORY, PRICE_CHANGE_MODE_SELECTED_ITEMS, PriceChangeMode } from "./dto/price-change-mode";
import {
  buildPriceChangeBatchReportFileName,
  buildPriceChangeBatchReportPdf,
  PriceChangeReportData,
  PriceChangeReportItemLine,
  PriceChangeReportStoreLine,
} from "./price-change-report.util";

// Rol ORIGEN: unicos nodos autorizados a crear un batch (Decision 2). "BODEGA001" se
// mantiene como alias defensivo de la bodega central, igual que en transfers.service.ts
// (Riesgo #2 del plan) aunque el nodo se identifique hoy como "ORIGEN".
// Sin timeout, una peticion colgada hacia el VPS puede congelar el ciclo de
// sincronizacion de cambios de precio. Ver fetch-with-timeout.util.ts.
const PRICE_CHANGE_SYNC_REQUEST_TIMEOUT_MS = 20000;

const PRICE_CHANGE_ORIGIN_NODE_IDS = new Set(["ORIGEN", "BODEGA001", "BODEGA002"]);
const DEFAULT_WAREHOUSE_NODE_ID = "ORIGEN";

const PRICE_CHANGE_BATCH_STATUS_DRAFT = "DRAFT";
const PRICE_CHANGE_BATCH_STATUS_SENDING_TO_VPS = "SENDING_TO_VPS";
const PRICE_CHANGE_BATCH_STATUS_SENT_TO_VPS = "SENT_TO_VPS";
const PRICE_CHANGE_BATCH_STATUS_PARTIAL_SENT_TO_VPS = "PARTIAL_SENT_TO_VPS";
const PRICE_CHANGE_BATCH_STATUS_WAITING_STORE_REFRESH = "WAITING_STORE_REFRESH";
const PRICE_CHANGE_BATCH_STATUS_PARTIAL_APPLIED = "PARTIAL_APPLIED";
const PRICE_CHANGE_BATCH_STATUS_APPLIED = "APPLIED";
const PRICE_CHANGE_BATCH_STATUS_FAILED = "FAILED";
// El resto del enum de 8 estados de Fase 3 se declara aqui por documentacion/paridad;
// los pasos 3+ del plan (envio/aplicacion) son los que efectivamente los asignan.
export const PRICE_CHANGE_BATCH_STATUSES = [
  PRICE_CHANGE_BATCH_STATUS_DRAFT,
  PRICE_CHANGE_BATCH_STATUS_SENDING_TO_VPS,
  PRICE_CHANGE_BATCH_STATUS_SENT_TO_VPS,
  PRICE_CHANGE_BATCH_STATUS_PARTIAL_SENT_TO_VPS,
  PRICE_CHANGE_BATCH_STATUS_WAITING_STORE_REFRESH,
  PRICE_CHANGE_BATCH_STATUS_PARTIAL_APPLIED,
  PRICE_CHANGE_BATCH_STATUS_APPLIED,
  PRICE_CHANGE_BATCH_STATUS_FAILED,
];

const PRICE_CHANGE_STORE_STATUS_PENDING_SEND = "PENDING_SEND";
const PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS = "SENT_TO_VPS";
const PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK = "FAILED_NETWORK";
const PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH = "WAITING_STORE_REFRESH";
const PRICE_CHANGE_STORE_STATUS_RECEIVED_BY_STORE = "RECEIVED_BY_STORE";
const PRICE_CHANGE_STORE_STATUS_APPLYING = "APPLYING";
const PRICE_CHANGE_STORE_STATUS_APPLIED = "APPLIED";
const PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED = "PARTIAL_APPLIED";
const PRICE_CHANGE_STORE_STATUS_FAILED_APPLY = "FAILED_APPLY";
// Resto del enum de 9 estados por tienda (Fase 3); los pasos 4+ (consumo/aplicacion local)
// son los que asignan RECEIVED_BY_STORE/APPLYING/APPLIED/PARTIAL_APPLIED/FAILED_APPLY.
export const PRICE_CHANGE_STORE_STATUSES = [
  PRICE_CHANGE_STORE_STATUS_PENDING_SEND,
  PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS,
  PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK,
  PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH,
  PRICE_CHANGE_STORE_STATUS_RECEIVED_BY_STORE,
  PRICE_CHANGE_STORE_STATUS_APPLYING,
  PRICE_CHANGE_STORE_STATUS_APPLIED,
  PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
  PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
];

// Rol VPS/REMOTO: dos EventType. PRICE_CHANGE_BATCH = origen->destino (Paso 3).
// PRICE_CHANGE_RESULT = destino->origen (este paso): mismo PRICE_CHANGE_SYNC_INBOX,
// reutilizado en sentido inverso, con SourceNodeId/DestinationNodeId de roles invertidos
// (tal como se dejo previsto en el diseno de Fase 3 del plan).
const PRICE_CHANGE_SYNC_EVENT_BATCH = "PRICE_CHANGE_BATCH";
const PRICE_CHANGE_SYNC_EVENT_RESULT = "PRICE_CHANGE_RESULT";
const PRICE_CHANGE_SYNC_STATUS_PENDING = "PENDING";
const PRICE_CHANGE_SYNC_STATUS_SENT = "SENT";
const PRICE_CHANGE_SYNC_STATUS_RECEIVED = "RECEIVED";

// Estado inicial de PRICE_CHANGE_BATCH_ITEM_RESULT al recibir localmente (Paso 4): matches
// el default de la columna en la DDL (Paso 1). El Paso 5 (aplicacion local) es el que la
// avanza a uno de los 6 estados terminales de abajo -- enum de 7 valores aprobado en el
// plan original (Fase "Estados por articulo").
const PRICE_CHANGE_ITEM_RESULT_STATUS_PENDING = "PENDING";
const PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED = "APPLIED";
const PRICE_CHANGE_ITEM_RESULT_STATUS_NOT_FOUND = "NOT_FOUND";
const PRICE_CHANGE_ITEM_RESULT_STATUS_INVALID_BARCODE = "INVALID_BARCODE";
const PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_SOURCE_BARCODE = "DUPLICATE_SOURCE_BARCODE";
const PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_TARGET_BARCODE = "DUPLICATE_TARGET_BARCODE";
const PRICE_CHANGE_ITEM_RESULT_STATUS_ERROR = "ERROR";
export const PRICE_CHANGE_ITEM_RESULT_STATUSES = [
  PRICE_CHANGE_ITEM_RESULT_STATUS_PENDING,
  PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED,
  PRICE_CHANGE_ITEM_RESULT_STATUS_NOT_FOUND,
  PRICE_CHANGE_ITEM_RESULT_STATUS_INVALID_BARCODE,
  PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_SOURCE_BARCODE,
  PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_TARGET_BARCODE,
  PRICE_CHANGE_ITEM_RESULT_STATUS_ERROR,
];

const PRICE_CHANGE_ITEM_INSERT_CHUNK_SIZE = 500;
const PRICE_CHANGE_DEFAULT_PULL_LIMIT = 50;

// Timer del rol LOCAL SERVICE (Paso 8.5). Mismos valores por defecto que el auto-retry de
// transfers/dev-returns (transfers.service.ts:37-39, dev-returns.service.ts:35-37) para que
// el ciclo de tienda corra a la misma cadencia que el resto de la sincronizacion.
const DEFAULT_PRICE_CHANGE_SYNC_AUTO_RETRY_INTERVAL_MS = 30_000;
const DEFAULT_PRICE_CHANGE_SYNC_AUTO_RETRY_STARTUP_DELAY_MS = 5_000;
const DEFAULT_PRICE_CHANGE_SYNC_AUTO_RETRY_LIMIT = 25;

const PRICE_CHANGE_ITEM_SELECT = {
  CodigoBarra: true,
  Nombre: true,
  CostoInicial: true,
  CostoPromedio: true,
  UltimoCosto: true,
  CostoDolar: true,
} satisfies Prisma.InventarioSelect;

type PriceChangeInventoryRow = Prisma.InventarioGetPayload<{ select: typeof PRICE_CHANGE_ITEM_SELECT }>;

type PriceChangeNodeContext = {
  nodeId: string;
  sucursalCodigo: string;
  nombre: string;
  tipo: string;
  // true solo cuando esta instancia es el representante VPS/REMOTO de una tienda/bodega
  // (DB con sufijo "_vps"), nunca la tienda/bodega FISICA. nodeId/tipo se mantienen
  // iguales entre ambas (misma identidad logica en SYNC_NODES/PRICE_CHANGE_BATCH_STORE);
  // este flag es la unica señal que debe usar el gating del timer LOCAL SERVICE.
  isVpsRemote: boolean;
};

type SyncNodeRow = {
  NodeId: string;
  SucursalCodigo: string;
  Nombre: string | null;
  Tipo: string | null;
  ApiUrl: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  LastSeenAt: Date | null;
};

type PriceChangeBatchRow = {
  BatchId: string;
  SourceNodeId: string;
  Mode: string;
  Status: string;
  RequestedBy: string;
  Observacion: string | null;
  TotalItems: number;
  TotalStores: number;
  CreatedAt: Date;
  UpdatedAt: Date;
};

// Los 4 costos vuelven de $queryRawUnsafe como number o Prisma.Decimal segun el driver;
// nunca se les hace aritmetica, solo se serializan via toDecimalString() (ver mas abajo).
type PriceChangeBatchItemRow = {
  BatchId: string;
  CodigoBarra: string;
  CostoInicial: unknown;
  CostoPromedio: unknown;
  UltimoCosto: unknown;
  CostoDolar: unknown;
};

type PriceChangeBatchStoreRow = {
  BatchId: string;
  DestinationNodeId: string;
  DestinationCode: string | null;
  DestinationName: string | null;
  ApiUrl: string | null;
  Status: string;
  Attempts: number;
  LastError: string | null;
  SentAt: Date | null;
  ReceivedAt: Date | null;
  AppliedAt: Date | null;
  AppliedCount: number;
  NotFoundCount: number;
  DuplicateSourceCount: number;
  DuplicateTargetCount: number;
  InvalidCount: number;
  ErrorCount: number;
  CreatedAt: Date;
  UpdatedAt: Date;
  ReportedAt: Date | null;
};

type PriceChangeSyncPayloadItem = {
  codigoBarra: string;
  costoInicial: string;
  costoPromedio: string;
  ultimoCosto: string;
  costoDolar: string;
};

type PriceChangeSyncPayload = {
  globalId: string;
  batchId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  mode: string;
  items: PriceChangeSyncPayloadItem[];
};

// Fila de PRICE_CHANGE_SYNC_INBOX (rol VPS/REMOTO). "Payload" vuelve ya parseado como
// objeto (Prisma deserializa jsonb automaticamente en $queryRawUnsafe).
type PriceChangeSyncInboxRow = {
  GlobalId: string;
  BatchId: string;
  SourceNodeId: string;
  DestinationNodeId: string;
  EventType: string;
  Payload: Record<string, unknown>;
  Status: string;
  ReceivedAt: Date;
  AppliedAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type PriceChangeItemResultRow = {
  CodigoBarra: string;
  Status: string;
  ErrorMessage: string | null;
};

type PriceChangeItemResultCounts = {
  appliedCount: number;
  notFoundCount: number;
  invalidBarcodeCount: number;
  duplicateSourceBarcodeCount: number;
  duplicateTargetBarcodeCount: number;
  errorCount: number;
  pendingCount: number;
};

@Injectable()
export class PriceChangesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceChangesService.name);

  // Timers del rol LOCAL SERVICE (Paso 8.5). Solo se arman en instancias de tienda destino.
  private priceChangeSyncTimer: ReturnType<typeof setInterval> | null = null;
  private priceChangeSyncStartupTimer: ReturnType<typeof setTimeout> | null = null;
  private priceChangeSyncCycleInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensurePriceChangeSyncSchema();
    this.startPriceChangeSyncTimer();
  }

  onModuleDestroy() {
    this.stopPriceChangeSyncTimer();
  }

  // --- Rol LOCAL SERVICE: ciclo automatico de tienda (Paso 8.5) --------------------------
  // Integra el ciclo pull -> apply -> report al mismo mecanismo de timer que ya usan
  // transfers/dev-returns, para que una tienda destino aplique los Cambios de Precio sin
  // intervencion manual. NO corre en el ORIGEN (Bodega Central / Bodega 002): esas
  // instancias solo crean/envian/consultan por pull desde la UI, nunca aplican Inventario.
  private startPriceChangeSyncTimer() {
    if (!this.isPriceChangeLocalServiceInstance()) {
      // Origen (o instancia sin identidad de tienda): el ciclo local no aplica aqui.
      this.logger.log(
        "Ciclo local de Cambio de Precio no se arma: esta instancia no es una tienda destino.",
      );
      return;
    }

    if (!this.isPriceChangeSyncAutoRetryEnabled()) {
      this.logger.log("Ciclo local automatico de Cambio de Precio deshabilitado por configuracion.");
      return;
    }

    if (this.priceChangeSyncTimer) {
      return;
    }

    const intervalMs = this.getPriceChangeSyncIntervalMs();
    const startupDelayMs = this.getPriceChangeSyncStartupDelayMs();

    this.priceChangeSyncStartupTimer = setTimeout(() => {
      this.priceChangeSyncStartupTimer = null;
      void this.runPriceChangeLocalServiceCycle("startup");
    }, startupDelayMs);

    this.priceChangeSyncTimer = setInterval(() => {
      void this.runPriceChangeLocalServiceCycle("interval");
    }, intervalMs);

    this.logger.log(`Ciclo local automatico de Cambio de Precio activo cada ${intervalMs} ms.`);
  }

  private stopPriceChangeSyncTimer() {
    if (this.priceChangeSyncStartupTimer) {
      clearTimeout(this.priceChangeSyncStartupTimer);
      this.priceChangeSyncStartupTimer = null;
    }

    if (this.priceChangeSyncTimer) {
      clearInterval(this.priceChangeSyncTimer);
      this.priceChangeSyncTimer = null;
    }
  }

  // Un solo tick del ciclo local. Los tres subpasos ya son idempotentes y atrapan sus
  // propios fallos por-fila (pull por inbox, apply por batch, report por batch); ademas se
  // envuelve cada subpaso para que si uno falla no impida el siguiente en el MISMO tick y
  // el ciclo tampoco quede bloqueado permanentemente (el proximo intervalo reintenta).
  // Solo emite log si algo se movio -> sin ruido cuando no hay pendientes.
  private async runPriceChangeLocalServiceCycle(reason: "startup" | "interval") {
    if (this.priceChangeSyncCycleInProgress) {
      return;
    }

    this.priceChangeSyncCycleInProgress = true;

    try {
      const limit = this.getPriceChangeSyncLimit();

      // fetch-remote (nuevo): trae por HTTP lo pendiente desde el VPS/REMOTO real de esta
      // tienda hacia PRICE_CHANGE_SYNC_INBOX local. Antes de este paso, pull no tenia nada
      // que materializar en una topologia donde VPS/REMOTO vive en una base *_vps* separada.
      const fetchRemote = await this.runPriceChangeSyncSubStep("fetch-remote", () =>
        this.pullPendingPriceChangesFromRemoteVps(limit),
      );
      const pull = await this.runPriceChangeSyncSubStep("pull", () =>
        this.pullPendingPriceChanges(limit),
      );
      const apply = await this.runPriceChangeSyncSubStep("apply", () =>
        this.applyPendingLocalPriceChanges(limit),
      );
      const report = await this.runPriceChangeSyncSubStep("report", () =>
        this.reportPendingPriceChangeResults(limit),
      );

      const fetched = fetchRemote?.fetched ?? 0;
      const pulled = pull?.received ?? 0;
      const applied = apply?.processed ?? 0;
      const reported = report?.results.filter((item) => item.reported).length ?? 0;

      if (fetched > 0 || (pull?.pulled ?? 0) > 0 || applied > 0 || (report?.processed ?? 0) > 0) {
        this.logger.log(
          `Ciclo local de Cambio de Precio (${reason}): fetch-remote=${fetched} (${fetchRemote?.imported ?? 0} importado(s)); pull=${pull?.pulled ?? 0} (${pulled} recibido(s)); apply=${applied} batch(es); report=${report?.processed ?? 0} (${reported} reportado(s)).`,
        );
      }
    } finally {
      this.priceChangeSyncCycleInProgress = false;
    }
  }

  // Corre un subpaso del ciclo aislando su fallo: registra el error y devuelve null para no
  // abortar los subpasos restantes ni el ciclo siguiente. Los subpasos operan sobre estado
  // ya persistido (apply lee filas ya materializadas por pulls previos; report lee filas ya
  // aplicadas), asi que un fallo de pull no impide aplicar/reportar lo que quedo de antes.
  private async runPriceChangeSyncSubStep<T>(
    label: "fetch-remote" | "pull" | "apply" | "report",
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      const message = this.extractPriceChangeErrorMessage(error);
      this.logger.warn(`Ciclo local de Cambio de Precio: fallo el subpaso ${label}: ${message}`);
      return null;
    }
  }

  // La aplicacion de costos en INVENTARIO solo corre en instancias de tienda destino
  // FISICAS (Decision 2). El ORIGEN (ORIGEN/BODEGA001/BODEGA002) nunca aplica localmente,
  // y el representante VPS/REMOTO de una tienda (isVpsRemote=true, DB "_vps") tampoco --
  // ese rol solo recibe/expone/reporta, nunca escribe Inventario (Decision 1).
  private isPriceChangeLocalServiceInstance() {
    const current = this.getCurrentSourceContext();
    return (
      current.tipo === "TIENDA" &&
      !current.isVpsRemote &&
      !PRICE_CHANGE_ORIGIN_NODE_IDS.has(current.nodeId)
    );
  }

  private isPriceChangeSyncAutoRetryEnabled() {
    return this.readBooleanConfig("PRICE_CHANGE_SYNC_AUTO_RETRY_ENABLED", true);
  }

  private getPriceChangeSyncIntervalMs() {
    return this.readPositiveIntegerConfig(
      "PRICE_CHANGE_SYNC_AUTO_RETRY_INTERVAL_MS",
      DEFAULT_PRICE_CHANGE_SYNC_AUTO_RETRY_INTERVAL_MS,
    );
  }

  private getPriceChangeSyncStartupDelayMs() {
    return this.readPositiveIntegerConfig(
      "PRICE_CHANGE_SYNC_AUTO_RETRY_STARTUP_DELAY_MS",
      DEFAULT_PRICE_CHANGE_SYNC_AUTO_RETRY_STARTUP_DELAY_MS,
    );
  }

  private getPriceChangeSyncLimit() {
    return this.readPositiveIntegerConfig(
      "PRICE_CHANGE_SYNC_AUTO_RETRY_LIMIT",
      DEFAULT_PRICE_CHANGE_SYNC_AUTO_RETRY_LIMIT,
    );
  }

  // Copia del patron de lectura de config de dev-returns.service.ts:4361-4400 (no hay un
  // helper compartido en el repo; cada servicio de sync re-declara el suyo).
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

    const parsed = Number.parseInt(String(rawValue).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  async previewPriceChangeBatch(dto: PreviewPriceChangeBatchDto) {
    const current = this.assertOriginAllowed();
    const resolved = await this.resolvePriceChangeItems(dto.mode, dto.codigosBarra);

    return {
      sourceNodeId: current.nodeId,
      mode: dto.mode,
      totalItems: resolved.items.length,
      items: resolved.items.map((item) => this.toPriceChangeItemPreviewView(item)),
      warnings: resolved.warnings,
    };
  }

  async createPriceChangeBatch(dto: CreatePriceChangeBatchDto, user: UserView) {
    this.assertSystemUser(user);
    const current = this.assertOriginAllowed();

    const resolved = await this.resolvePriceChangeItems(dto.mode, dto.codigosBarra);
    if (resolved.items.length === 0) {
      throw new BadRequestException(
        "No hay articulos para incluir en el batch: ninguno de los codigos de barra solicitados existe en el inventario de origen.",
      );
    }

    const destinations = await this.resolvePriceChangeDestinations(dto.destinationNodeIds, current);

    const batchId = randomUUID();

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `
            insert into dbo."PRICE_CHANGE_BATCH"
              ("BatchId", "SourceNodeId", "Mode", "Status", "RequestedBy", "Observacion", "TotalItems", "TotalStores")
            values ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          batchId,
          current.nodeId,
          dto.mode,
          PRICE_CHANGE_BATCH_STATUS_DRAFT,
          user.codUsuario,
          dto.observacion ?? null,
          resolved.items.length,
          destinations.length,
        );

        await this.insertPriceChangeBatchItems(tx, batchId, resolved.items);

        for (const destination of destinations) {
          await tx.$executeRawUnsafe(
            `
              insert into dbo."PRICE_CHANGE_BATCH_STORE"
                ("BatchId", "DestinationNodeId", "DestinationCode", "DestinationName", "ApiUrl", "Status")
              values ($1, $2, $3, $4, $5, $6)
            `,
            batchId,
            destination.NodeId,
            destination.SucursalCodigo,
            destination.Nombre,
            destination.ApiUrl,
            PRICE_CHANGE_STORE_STATUS_PENDING_SEND,
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      batchId,
      sourceNodeId: current.nodeId,
      mode: dto.mode,
      status: PRICE_CHANGE_BATCH_STATUS_DRAFT,
      requestedBy: user.codUsuario,
      observacion: dto.observacion ?? null,
      totalItems: resolved.items.length,
      totalStores: destinations.length,
      stores: destinations.map((destination) => ({
        destinationNodeId: destination.NodeId,
        destinationCode: destination.SucursalCodigo,
        destinationName: destination.Nombre,
        status: PRICE_CHANGE_STORE_STATUS_PENDING_SEND,
      })),
    };
  }

  // Rol ORIGEN -> rol VPS/REMOTO. Envia/reintenta un batch existente hacia sus tiendas
  // destino en PENDING_SEND o FAILED_NETWORK. Cada tienda se intenta de forma
  // independiente: el fallo de una nunca bloquea ni revierte el envio a las demas.
  async sendPriceChangeBatch(batchId: string) {
    const current = this.assertOriginAllowed();
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);
    this.assertBatchBelongsToCurrentOrigin(batch, current);

    const items = await this.getPriceChangeBatchItemRows(batchId);
    if (items.length === 0) {
      throw new ConflictException("El batch no tiene articulos validos para enviar.");
    }

    const allStores = await this.getPriceChangeBatchStoreRows(batchId);
    const eligible = allStores.filter((store) =>
      store.Status === PRICE_CHANGE_STORE_STATUS_PENDING_SEND ||
      store.Status === PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK,
    );

    if (eligible.length === 0) {
      return this.buildPriceChangeBatchSendResult(batch, allStores, {
        sentCount: 0,
        failedCount: 0,
        message: "No hay tiendas en PENDING_SEND o FAILED_NETWORK para enviar.",
      });
    }

    return this.runPriceChangeBatchSend(current, batch, items, eligible);
  }

  // Igual que sendPriceChangeBatch, pero SOLO opera sobre tiendas en FAILED_NETWORK
  // (nunca PENDING_SEND ni estados ya avanzados). Si se piden destinationNodeIds
  // especificos que no esten en FAILED_NETWORK, rechaza en vez de ignorarlos en silencio.
  async retryPriceChangeBatchStores(batchId: string, destinationNodeIds?: string[]) {
    const current = this.assertOriginAllowed();
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);
    this.assertBatchBelongsToCurrentOrigin(batch, current);

    const items = await this.getPriceChangeBatchItemRows(batchId);
    if (items.length === 0) {
      throw new ConflictException("El batch no tiene articulos validos para enviar.");
    }

    const allStores = await this.getPriceChangeBatchStoreRows(batchId);
    const requestedIds =
      destinationNodeIds && destinationNodeIds.length > 0
        ? Array.from(new Set(destinationNodeIds.map((nodeId) => nodeId.toUpperCase())))
        : null;

    let eligible: PriceChangeBatchStoreRow[];
    if (requestedIds) {
      const invalid = requestedIds.filter((nodeId) => {
        const store = allStores.find((item) => item.DestinationNodeId.toUpperCase() === nodeId);
        return !store || store.Status !== PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK;
      });
      if (invalid.length > 0) {
        throw new ConflictException(
          `Solo se pueden reintentar tiendas en estado FAILED_NETWORK. No aplica para: ${invalid.join(", ")}.`,
        );
      }
      eligible = allStores.filter((store) => requestedIds.includes(store.DestinationNodeId.toUpperCase()));
    } else {
      eligible = allStores.filter((store) => store.Status === PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK);
    }

    if (eligible.length === 0) {
      return this.buildPriceChangeBatchSendResult(batch, allStores, {
        sentCount: 0,
        failedCount: 0,
        message: "No hay tiendas en FAILED_NETWORK para reintentar.",
      });
    }

    return this.runPriceChangeBatchSend(current, batch, items, eligible);
  }

  async getPriceChangeBatch(batchId: string) {
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);
    const stores = await this.getPriceChangeBatchStoreRows(batchId);

    return {
      batchId: batch.BatchId,
      sourceNodeId: batch.SourceNodeId,
      mode: batch.Mode,
      status: batch.Status,
      requestedBy: batch.RequestedBy,
      observacion: batch.Observacion,
      totalItems: batch.TotalItems,
      totalStores: batch.TotalStores,
      createdAt: batch.CreatedAt,
      updatedAt: batch.UpdatedAt,
      stores: stores.map((store) => this.toPriceChangeBatchStoreView(store)),
    };
  }

  // Rol ORIGEN, solo lectura: arma los datos consolidados para el PDF. Nunca consulta el
  // VPS/remoto (no llama pullRemotePriceChangeStatus ni nada de red), nunca cambia estados,
  // nunca toca Inventario -- lee unicamente PRICE_CHANGE_BATCH/_STORE/_ITEM/_ITEM_RESULT
  // (ya consolidadas por el Paso 6) + SYNC_NODES para enriquecer el nombre del origen. No
  // depende de PRICE_CHANGE_SYNC_INBOX.
  async getPriceChangeBatchReportData(batchId: string): Promise<PriceChangeReportData> {
    const current = this.getCurrentSourceContext();
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);
    const stores = await this.getPriceChangeBatchStoreRows(batchId);
    const items = await this.getPriceChangeBatchItemRows(batchId);
    const sourceNode = await this.findSyncNodeById(batch.SourceNodeId);

    const storeLines: PriceChangeReportStoreLine[] = [];
    for (const store of stores) {
      const results = await this.getPriceChangeItemResultRowsWithCosts(batchId, store.DestinationNodeId);
      const resultsByCode = new Map(results.map((result) => [result.CodigoBarra, result]));

      const itemLines: PriceChangeReportItemLine[] = items.map((item) => {
        const sentCosts = {
          costoInicial: this.toDecimalString(item.CostoInicial),
          costoPromedio: this.toDecimalString(item.CostoPromedio),
          ultimoCosto: this.toDecimalString(item.UltimoCosto),
          costoDolar: this.toDecimalString(item.CostoDolar),
        };
        const result = resultsByCode.get(item.CodigoBarra);
        // Sin resultado todavia (tienda enviada/pendiente, sin consolidar): se muestra
        // como PENDING con el costo ENVIADO como referencia, nunca como "aplicado".
        if (!result) {
          return { codigoBarra: item.CodigoBarra, status: PRICE_CHANGE_ITEM_RESULT_STATUS_PENDING, errorMessage: null, sentCosts, appliedCosts: null };
        }

        const appliedCosts =
          result.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED && result.AppliedCostoInicial !== null
            ? {
                costoInicial: this.toDecimalString(result.AppliedCostoInicial),
                costoPromedio: this.toDecimalString(result.AppliedCostoPromedio),
                ultimoCosto: this.toDecimalString(result.AppliedUltimoCosto),
                costoDolar: this.toDecimalString(result.AppliedCostoDolar),
              }
            : null;

        return { codigoBarra: item.CodigoBarra, status: result.Status, errorMessage: result.ErrorMessage, sentCosts, appliedCosts };
      });

      storeLines.push({
        destinationNodeId: store.DestinationNodeId,
        destinationCode: store.DestinationCode,
        destinationName: store.DestinationName,
        status: store.Status,
        lastError: store.LastError,
        attempts: store.Attempts,
        sentAt: store.SentAt,
        appliedAt: store.AppliedAt,
        totals: {
          totalItems: items.length,
          appliedCount: store.AppliedCount,
          notFoundCount: store.NotFoundCount,
          invalidBarcodeCount: store.InvalidCount,
          duplicateSourceBarcodeCount: store.DuplicateSourceCount,
          duplicateTargetBarcodeCount: store.DuplicateTargetCount,
          errorCount: store.ErrorCount,
        },
        items: itemLines,
      });
    }

    return {
      batchId: batch.BatchId,
      mode: batch.Mode,
      status: batch.Status,
      sourceNodeId: batch.SourceNodeId,
      sourceNodeName: sourceNode?.Nombre ?? null,
      sourceNodeCode: sourceNode?.SucursalCodigo ?? null,
      requestedBy: batch.RequestedBy,
      observacion: batch.Observacion,
      createdAt: batch.CreatedAt,
      updatedAt: batch.UpdatedAt,
      totalItems: batch.TotalItems,
      totalStores: batch.TotalStores,
      stores: storeLines,
      generatedAt: new Date(),
      generatedByNodeId: current.nodeId,
    };
  }

  // Genera el PDF (Buffer) a partir de los datos consolidados. Endpoint read-only: no
  // envia sync, no aplica, no cambia estados -- ver getPriceChangeBatchReportData.
  async generatePriceChangeBatchReportPdf(batchId: string) {
    const data = await this.getPriceChangeBatchReportData(batchId);
    return {
      fileName: buildPriceChangeBatchReportFileName(batchId),
      pdf: buildPriceChangeBatchReportPdf(data),
    };
  }

  // Rol VPS/REMOTO. Solo guarda el batch como pendiente (PRICE_CHANGE_SYNC_INBOX =
  // RECEIVED); NUNCA aplica costos en Inventario aqui (eso es exclusivo del rol LOCAL
  // SERVICE, en un paso posterior y separado). Idempotente por GlobalId: una segunda
  // entrega del mismo batch+destino no duplica ni reescribe nada, solo confirma el estado
  // ya existente.
  async importRemotePriceChangeBatch(body: Record<string, unknown>) {
    const payload = this.normalizePriceChangeSyncPayload(body);

    const current = this.getCurrentSourceContext();
    if (current.nodeId.toUpperCase() !== payload.destinationNodeId.toUpperCase()) {
      throw new ConflictException(
        `Este nodo (${current.nodeId}) no es el destino esperado del batch (${payload.destinationNodeId}).`,
      );
    }

    const existing = await this.getPriceChangeSyncInboxRow(payload.globalId);
    if (existing) {
      return {
        imported: false,
        message: "Este Cambio de Precio ya habia sido recibido por este nodo; no se duplico nada.",
        globalId: payload.globalId,
        batchId: payload.batchId,
        status: existing.Status,
      };
    }

    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."PRICE_CHANGE_SYNC_INBOX"
          ("GlobalId", "BatchId", "SourceNodeId", "DestinationNodeId", "EventType", "Payload", "Status")
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        on conflict ("GlobalId") do nothing
      `,
      payload.globalId,
      payload.batchId,
      payload.sourceNodeId,
      payload.destinationNodeId,
      PRICE_CHANGE_SYNC_EVENT_BATCH,
      JSON.stringify(body),
      PRICE_CHANGE_SYNC_STATUS_RECEIVED,
    );

    return {
      imported: true,
      message: "Cambio de Precio recibido y guardado como pendiente. Se aplicara en el proximo refresco local.",
      globalId: payload.globalId,
      batchId: payload.batchId,
      status: PRICE_CHANGE_SYNC_STATUS_RECEIVED,
    };
  }

  // Rol VPS/REMOTO: expone lo pendiente (Status='RECEIVED') dirigido a ESTE nodo. No
  // borra ni marca nada al listar -- una segunda consulta puede devolver el mismo
  // pendiente hasta que exista aplicacion/reporte (pasos futuros).
  async listPendingPriceChangeSyncForCurrentNode(limit = PRICE_CHANGE_DEFAULT_PULL_LIMIT) {
    const current = this.getCurrentSourceContext();
    return this.prisma.$queryRawUnsafe<PriceChangeSyncInboxRow[]>(
      `
        select "GlobalId", "BatchId", "SourceNodeId", "DestinationNodeId", "EventType", "Payload", "Status", "ReceivedAt", "AppliedAt", "Attempts", "LastError"
        from dbo."PRICE_CHANGE_SYNC_INBOX"
        where upper("DestinationNodeId") = upper($1) and "Status" = $2
        order by "ReceivedAt" asc
        limit $3
      `,
      current.nodeId,
      PRICE_CHANGE_SYNC_STATUS_RECEIVED,
      limit,
    );
  }

  // Rol LOCAL SERVICE: consulta lo pendiente de su propio rol VPS/REMOTO. Hoy ambos roles
  // corren en el mismo proceso/DB (Decision 1), asi que esta "consulta" es una llamada de
  // metodo directa a listPendingPriceChangeSyncForCurrentNode() en vez de un salto HTTP;
  // el limite entre roles se mantiene a nivel de metodo/responsabilidad, no de red, para
  // no introducir un loopback HTTP autenticado contra si mismo sin beneficio real hoy. Si
  // algun dia se despliegan por separado, este metodo es el unico punto que cambiaria a
  // una llamada HTTP real (mismo patron login+fetch que postPriceChangeSyncPackage).
  //
  // Materializa localmente cada batch recibido (PRICE_CHANGE_BATCH/_ITEM/_STORE +
  // resultados PENDING) sin aplicar costos todavia -- eso es responsabilidad del Paso 5.
  async pullPendingPriceChanges(limit = PRICE_CHANGE_DEFAULT_PULL_LIMIT) {
    const pending = await this.listPendingPriceChangeSyncForCurrentNode(limit);
    const results: Array<{
      globalId: string;
      batchId: string;
      received: boolean;
      alreadyReceived?: boolean;
      error?: string;
    }> = [];

    for (const inboxRow of pending) {
      try {
        results.push(await this.receivePriceChangeBatchLocally(inboxRow));
      } catch (error) {
        const message = this.extractPriceChangeErrorMessage(error);
        this.logger.warn(`No se pudo recibir localmente el Cambio de Precio ${inboxRow.GlobalId}: ${message}`);
        results.push({ globalId: inboxRow.GlobalId, batchId: inboxRow.BatchId, received: false, error: message });
      }
    }

    return {
      pulled: pending.length,
      received: results.filter((result) => result.received).length,
      alreadyReceived: results.filter((result) => result.alreadyReceived).length,
      failed: results.filter((result) => !result.received && !result.alreadyReceived).length,
      results,
    };
  }

  // Rol LOCAL SERVICE -> rol VPS/REMOTO (nodo REMOTO real, no colocado): trae por HTTP lo
  // pendiente desde EL PROPIO gemelo VPS de esta tienda (resuelto via SYNC_NODES, mismo
  // ApiUrl que el ORIGEN usa para enviarle batches) y lo guarda localmente. Cierra el hueco
  // documentado en pullPendingPriceChanges()/listPendingPriceChangeSyncForCurrentNode(): esos
  // dos metodos SOLO leen la PRICE_CHANGE_SYNC_INBOX de esta misma base -- si el VPS/REMOTO
  // de esta tienda vive en una base *_vps* separada (topologia real confirmada: tienda
  // fisica = rocky_tienda_NNN, VPS = rocky_tienda_NNN_vps, conectadas solo por HTTP), esta
  // tienda nunca veria nada sin este paso adicional.
  //
  // No aplica Inventario aqui -- solo hace lo mismo que haria un POST entrante real a
  // /price-changes/sync/import (importRemotePriceChangeBatch, idempotente por GlobalId via
  // "on conflict do nothing"). La materializacion (PRICE_CHANGE_BATCH/_ITEM/_STORE) sigue
  // siendo responsabilidad de pullPendingPriceChanges() y la aplicacion de costos sigue
  // siendo exclusiva de applyPendingLocalPriceChanges() -- este metodo no cambia esa
  // separacion de responsabilidades, solo agrega el salto HTTP que faltaba antes de ella.
  async pullPendingPriceChangesFromRemoteVps(limit = PRICE_CHANGE_DEFAULT_PULL_LIMIT) {
    const current = this.getCurrentSourceContext();
    if (!this.isPriceChangeLocalServiceInstance()) {
      // Origen y representantes VPS/REMOTO (isVpsRemote=true) no tienen un "propio VPS" del
      // cual traer nada -- no-op informativo, nunca un error, para que el ciclo automatico
      // (Paso 8.5) no genere ruido si por alguna razon corriera fuera de una tienda fisica.
      return {
        skipped: true,
        message: "Esta instancia no es una tienda LOCAL SERVICE; no hay VPS/REMOTO propio del cual traer pendientes.",
        fetched: 0,
        imported: 0,
        alreadyReceived: 0,
        failed: 0,
        results: [],
      };
    }

    const apiUrl = await this.resolveOwnPriceChangeRemoteApiUrl(current.nodeId);
    if (!apiUrl) {
      return {
        skipped: true,
        message: `No hay URL configurada (PRICE_CHANGE_REMOTE_API_URL/MIRROR_SYNC_REMOTE_API_URL) para el VPS/REMOTO propio de ${current.nodeId}.`,
        fetched: 0,
        imported: 0,
        alreadyReceived: 0,
        failed: 0,
        results: [],
      };
    }

    const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
    const token = await this.loginRemotePriceChangeNode(baseUrl);
    const response = await fetchWithTimeout(
      `${baseUrl}/api/price-changes/sync/pending?limit=${limit}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      PRICE_CHANGE_SYNC_REQUEST_TIMEOUT_MS,
    );

    const responseBody = await this.readRemoteJson(response);
    if (!response.ok) {
      throw new Error(`No se pudo consultar pendientes del VPS/REMOTO: ${this.formatRemoteError(responseBody, response.status)}`);
    }
    const pendingRemote = this.isRecord(responseBody) && Array.isArray(responseBody.pending) ? responseBody.pending : [];

    const results: Array<{ globalId: string | null; imported: boolean; alreadyReceived?: boolean; error?: string }> = [];
    for (const rawItem of pendingRemote) {
      if (!this.isRecord(rawItem) || !this.isRecord(rawItem.Payload)) {
        continue;
      }

      try {
        const importResult = await this.importRemotePriceChangeBatch(rawItem.Payload as Record<string, unknown>);
        results.push({
          globalId: typeof rawItem.GlobalId === "string" ? rawItem.GlobalId : null,
          imported: importResult.imported,
          alreadyReceived: !importResult.imported,
        });
      } catch (error) {
        const message = this.extractPriceChangeErrorMessage(error);
        this.logger.warn(`No se pudo importar localmente el pendiente remoto ${rawItem.GlobalId}: ${message}`);
        results.push({
          globalId: typeof rawItem.GlobalId === "string" ? rawItem.GlobalId : null,
          imported: false,
          error: message,
        });
      }
    }

    return {
      skipped: false,
      fetched: pendingRemote.length,
      imported: results.filter((result) => result.imported).length,
      alreadyReceived: results.filter((result) => result.alreadyReceived).length,
      failed: results.filter((result) => !result.imported && !result.alreadyReceived).length,
      results,
    };
  }

  // Rol LOCAL SERVICE: aplica en INVENTARIO local UN batch ya materializado (Paso 4).
  // Match estricto por CodigoBarra exacto (sin LIKE, sin normalizacion, sin codigo
  // interno). Nunca toca envio de resultado al VPS/remoto ni PDF/UI (eso es Paso 6+).
  async applyLocalPriceChangeBatch(batchId: string) {
    const current = this.getCurrentSourceContext();
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);

    const store = await this.getPriceChangeBatchStoreRowForNode(batchId, current.nodeId);
    if (!store) {
      // Cubre tanto "este batch nunca fue recibido aqui" como "este nodo es el ORIGEN de
      // este batch, no un destino" (las filas de PRICE_CHANGE_BATCH_STORE del origen usan
      // OTROS nodeId como DestinationNodeId, nunca el propio) -- por eso PENDING_SEND y
      // SENT_TO_VPS (estados del rol ORIGEN) nunca pueden aparecer aqui.
      throw new ConflictException(
        `El batch ${batchId} no esta dirigido a este nodo (${current.nodeId}); no se puede aplicar aqui.`,
      );
    }

    const inboxRow = await this.getPriceChangeSyncInboxRowForBatch(batchId, current.nodeId);

    // Estados elegibles: RECEIVED_BY_STORE (primera vez) y APPLYING (reentrada
    // controlada tras un corte a mitad de aplicacion). APPLIED/PARTIAL_APPLIED/
    // FAILED_APPLY -> no-op informativo, sin reaplicar ni duplicar resultados.
    const eligibleStoreStatuses = new Set([
      PRICE_CHANGE_STORE_STATUS_RECEIVED_BY_STORE,
      PRICE_CHANGE_STORE_STATUS_APPLYING,
    ]);
    if (!eligibleStoreStatuses.has(store.Status)) {
      return this.buildPriceChangeApplyResult(batch, store, [], inboxRow?.GlobalId, {
        message: `Este batch ya esta en estado ${store.Status}; no se reaplica.`,
      });
    }

    const itemRows = await this.getPriceChangeBatchItemRows(batchId);
    if (itemRows.length === 0) {
      throw new ConflictException("El batch no tiene articulos para aplicar.");
    }

    // Duplicados de origen (DUPLICATE_SOURCE_BARCODE) solo se pueden detectar contra el
    // payload crudo del inbox: PRICE_CHANGE_BATCH_ITEM/_ITEM_RESULT ya llegan
    // deduplicados por su propia PK (BatchId+CodigoBarra), asi que un duplicado real del
    // origen ya coalescio a 1 sola fila para cuando este metodo corre. Este chequeo queda
    // como defensa (hoy nuestro propio ORIGEN ya rechaza duplicados al crear el batch,
    // ver resolvePriceChangeItems en createPriceChangeBatch) para paths futuros/externos.
    const duplicateSourceCodes = inboxRow ? this.extractDuplicateSourceCodes(inboxRow.Payload) : new Set<string>();

    if (store.Status !== PRICE_CHANGE_STORE_STATUS_APPLYING) {
      await this.updatePriceChangeBatchStoreStatusOnly(batchId, current.nodeId, PRICE_CHANGE_STORE_STATUS_APPLYING);
    }

    const itemsByCode = new Map(itemRows.map((item) => [item.CodigoBarra, item]));
    const pendingResults = await this.getPriceChangePendingItemResults(batchId, current.nodeId);

    for (const codigoBarra of pendingResults) {
      await this.applyOnePriceChangeItem(batchId, current.nodeId, codigoBarra, itemsByCode, duplicateSourceCodes);
    }

    const allResults = await this.getPriceChangeItemResultRows(batchId, current.nodeId);
    const counts = this.summarizePriceChangeItemResults(allResults);
    const finalStoreStatus = this.computePriceChangeApplyStoreStatus(counts, itemRows.length);
    const finalBatchStatus = this.computePriceChangeApplyBatchStatus(counts, itemRows.length);

    await this.finalizePriceChangeBatchAndStoreAfterApply(
      batchId,
      current.nodeId,
      finalStoreStatus,
      finalBatchStatus,
      counts,
    );

    return this.buildPriceChangeApplyResult(
      { ...batch, Status: finalBatchStatus },
      {
        ...store,
        Status: finalStoreStatus,
        AppliedCount: counts.appliedCount,
        NotFoundCount: counts.notFoundCount,
        InvalidCount: counts.invalidBarcodeCount,
        DuplicateSourceCount: counts.duplicateSourceBarcodeCount,
        DuplicateTargetCount: counts.duplicateTargetBarcodeCount,
        ErrorCount: counts.errorCount,
      },
      allResults,
      inboxRow?.GlobalId,
    );
  }

  // Opcional (Paso 5): aplica TODOS los batches locales pendientes de este nodo de una
  // vez. Reutilizable por un futuro timer, igual que pullPendingPriceChanges en Paso 4.
  async applyPendingLocalPriceChanges(limit = PRICE_CHANGE_DEFAULT_PULL_LIMIT) {
    const current = this.getCurrentSourceContext();
    const eligibleStores = await this.prisma.$queryRawUnsafe<Array<{ BatchId: string }>>(
      `
        select "BatchId" from dbo."PRICE_CHANGE_BATCH_STORE"
        where upper("DestinationNodeId") = upper($1) and "Status" in ($2, $3)
        order by "CreatedAt" asc
        limit $4
      `,
      current.nodeId,
      PRICE_CHANGE_STORE_STATUS_RECEIVED_BY_STORE,
      PRICE_CHANGE_STORE_STATUS_APPLYING,
      limit,
    );

    const results = [];
    for (const row of eligibleStores) {
      try {
        results.push(await this.applyLocalPriceChangeBatch(row.BatchId));
      } catch (error) {
        const message = this.extractPriceChangeErrorMessage(error);
        this.logger.warn(`No se pudo aplicar localmente el batch ${row.BatchId}: ${message}`);
        results.push({ batchId: row.BatchId, error: message });
      }
    }

    return { processed: results.length, results };
  }

  // Rol LOCAL SERVICE -> rol VPS/REMOTO (de este mismo nodo; ver Decision 1, igual patron
  // de llamada directa que pullPendingPriceChanges en el Paso 4). Reporta el resultado
  // final de UN batch ya en estado terminal. Sin costos en el payload (no son necesarios
  // para el reporte). Idempotente: reportar dos veces solo reescribe la MISMA fila
  // (GlobalId deterministico), nunca duplica.
  async reportLocalPriceChangeResult(batchId: string) {
    const current = this.getCurrentSourceContext();
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);
    const store = await this.getPriceChangeBatchStoreRowForNode(batchId, current.nodeId);
    if (!store) {
      throw new ConflictException(`El batch ${batchId} no esta dirigido a este nodo (${current.nodeId}).`);
    }

    const terminalStoreStatuses = new Set([
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
    ]);
    if (!terminalStoreStatuses.has(store.Status)) {
      return {
        batchId,
        reported: false,
        message: `Este batch todavia no tiene un resultado local terminal (Status=${store.Status}); no hay nada que reportar.`,
      };
    }

    const itemResults = await this.getPriceChangeItemResultRows(batchId, current.nodeId);
    const counts = this.summarizePriceChangeItemResults(itemResults);
    const globalId = this.buildPriceChangeResultGlobalId(current.nodeId, batchId);

    const payload = {
      schemaVersion: 1,
      eventType: PRICE_CHANGE_SYNC_EVENT_RESULT,
      globalId,
      batchId,
      sourceNodeId: batch.SourceNodeId,
      destinationNodeId: current.nodeId,
      finalStoreStatus: store.Status,
      finalBatchStatus: batch.Status,
      appliedAt: (store.AppliedAt ?? new Date()).toISOString(),
      reportedAt: new Date().toISOString(),
      counts: {
        totalItems: batch.TotalItems,
        appliedCount: counts.appliedCount,
        notFoundCount: counts.notFoundCount,
        invalidBarcodeCount: counts.invalidBarcodeCount,
        duplicateSourceBarcodeCount: counts.duplicateSourceBarcodeCount,
        duplicateTargetBarcodeCount: counts.duplicateTargetBarcodeCount,
        errorCount: counts.errorCount,
      },
      itemResults: itemResults.map((row) => ({
        codigoBarra: row.CodigoBarra,
        status: row.Status,
        errorMessage: row.ErrorMessage,
      })),
    };

    try {
      // Rol LOCAL SERVICE -> rol VPS/REMOTO real: reporta por HTTP hacia EL PROPIO gemelo
      // VPS de esta tienda (resuelto via SYNC_NODES, mismo ApiUrl que ya usa el ORIGEN para
      // enviarle batches). Corrige el mismo hueco de topologia ya cerrado para el pull
      // (pullPendingPriceChangesFromRemoteVps): llamar this.receivePriceChangeSyncResult(...)
      // directo asumia VPS/REMOTO colocado en la misma base, lo cual es falso quando la
      // tienda fisica y su gemelo VPS son bases separadas (rocky_tienda_NNN vs
      // rocky_tienda_NNN_vps) -- el resultado quedaba guardado localmente y nunca llegaba
      // al VPS, por lo que el ORIGEN nunca lo veia via remote-status.
      const apiUrl = await this.resolveOwnPriceChangeRemoteApiUrl(current.nodeId);
      if (!apiUrl) {
        throw new Error(
          `No hay URL configurada (PRICE_CHANGE_REMOTE_API_URL/MIRROR_SYNC_REMOTE_API_URL) para el VPS/REMOTO propio de ${current.nodeId}; no se puede reportar.`,
        );
      }

      const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
      const token = await this.loginRemotePriceChangeNode(baseUrl);
      const response = await fetchWithTimeout(
        `${baseUrl}/api/price-changes/sync/report-result`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        PRICE_CHANGE_SYNC_REQUEST_TIMEOUT_MS,
      );

      const receipt = await this.readRemoteJson(response);
      if (!response.ok) {
        throw new Error(`El VPS/REMOTO rechazo el resultado del Cambio de Precio: ${this.formatRemoteError(receipt, response.status)}`);
      }

      // Marca este batch como ya reportado para que reportPendingPriceChangeResults() deje
      // de volver a seleccionarlo en el proximo ciclo (ver columna ReportedAt en
      // ensurePriceChangeSyncSchema). Si esta actualizacion fallara, el peor caso es que se
      // vuelva a reportar (idempotente del lado VPS), nunca que se pierda un reporte real.
      await this.prisma.$executeRawUnsafe(
        `update dbo."PRICE_CHANGE_BATCH_STORE" set "ReportedAt" = now() where "BatchId" = $1 and upper("DestinationNodeId") = upper($2)`,
        batchId,
        current.nodeId,
      );

      return { batchId, reported: true, globalId, receipt };
    } catch (error) {
      // No se altera nada local (PRICE_CHANGE_BATCH_ITEM_RESULT/_STORE quedan intactos);
      // reintentar es simplemente volver a llamar este mismo metodo. Idempotente del lado
      // VPS (receivePriceChangeSyncResult hace upsert por GlobalId determinístico), asi que
      // reportar dos veces tras un reintento nunca duplica nada.
      const message = this.extractPriceChangeErrorMessage(error);
      this.logger.warn(`No se pudo reportar el resultado de Cambio de Precio ${batchId}: ${message}`);
      return { batchId, reported: false, error: message };
    }
  }

  // Opcional: reporta TODOS los batches locales en estado terminal de este nodo.
  // Idempotente por batch (ver arriba), asi que reprocesar uno ya reportado es inofensivo.
  //
  // Fix: el filtro `"ReportedAt" is null` es lo que evita que, con mas de `limit` batches
  // terminales a la vez, esta consulta siga devolviendo para siempre los mismos `limit` mas
  // viejos (su UpdatedAt no cambia solo por reportarse) -- sin el, los batches mas nuevos
  // nunca llegaban a su turno de reportarse aunque ya estuvieran aplicados localmente.
  async reportPendingPriceChangeResults(limit = PRICE_CHANGE_DEFAULT_PULL_LIMIT) {
    const current = this.getCurrentSourceContext();
    const terminalStores = await this.prisma.$queryRawUnsafe<Array<{ BatchId: string }>>(
      `
        select "BatchId" from dbo."PRICE_CHANGE_BATCH_STORE"
        where upper("DestinationNodeId") = upper($1) and "Status" in ($2, $3, $4) and "ReportedAt" is null
        order by "UpdatedAt" asc
        limit $5
      `,
      current.nodeId,
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
      limit,
    );

    const results = [];
    for (const row of terminalStores) {
      try {
        results.push(await this.reportLocalPriceChangeResult(row.BatchId));
      } catch (error) {
        const message = this.extractPriceChangeErrorMessage(error);
        results.push({ batchId: row.BatchId, reported: false, error: message });
      }
    }
    return { processed: results.length, results };
  }

  // Rol VPS/REMOTO: recibe el resultado reportado por el rol LOCAL SERVICE (de este mismo
  // nodo hoy) y lo guarda como una fila PRICE_CHANGE_SYNC_INBOX adicional, EventType=
  // PRICE_CHANGE_RESULT, con los roles de SourceNodeId/DestinationNodeId invertidos
  // respecto al evento PRICE_CHANGE_BATCH original (este evento viaja destino->origen).
  // Nunca toca Inventario ni PRICE_CHANGE_BATCH*.
  async receivePriceChangeSyncResult(body: Record<string, unknown>) {
    const result = this.normalizePriceChangeResultPayload(body);

    const current = this.getCurrentSourceContext();
    if (current.nodeId.toUpperCase() !== result.destinationNodeId.toUpperCase()) {
      throw new ConflictException(
        `Este nodo (${current.nodeId}) no es el destino esperado del resultado (${result.destinationNodeId}).`,
      );
    }

    // Debe existir el inbox del batch original (Paso 3) para poder reportar un resultado
    // sobre el -- si no existe, este nodo nunca recibio ese batch.
    const batchInbox = await this.getPriceChangeSyncInboxRowForBatch(result.batchId, current.nodeId);
    if (!batchInbox) {
      throw new NotFoundException(
        `No existe un Cambio de Precio recibido (${result.batchId}) para reportar resultado en este nodo.`,
      );
    }

    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."PRICE_CHANGE_SYNC_INBOX"
          ("GlobalId", "BatchId", "SourceNodeId", "DestinationNodeId", "EventType", "Payload", "Status", "AppliedAt")
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
        on conflict ("GlobalId") do update set
          "Payload" = excluded."Payload",
          "Status" = excluded."Status",
          "AppliedAt" = now()
      `,
      result.globalId,
      result.batchId,
      current.nodeId,
      result.sourceNodeId,
      PRICE_CHANGE_SYNC_EVENT_RESULT,
      JSON.stringify(body),
      result.finalStoreStatus,
    );

    // Fix: mismo bug que en receivePriceChangeBatchLocally/finalizePriceChangeBatchAndStoreAfterApply,
    // pero del lado del VPS/REMOTO -- sin esto, la fila original PRICE_CHANGE_BATCH del inbox
    // se quedaba en 'RECEIVED' para siempre aunque ya llegara su resultado terminal, ocupando
    // el cupo del LIMIT en listPendingPriceChangeSyncForCurrentNode (usado por GET /sync/pending)
    // y bloqueando que la tienda viera batches nuevos genuinamente pendientes.
    await this.prisma.$executeRawUnsafe(
      `update dbo."PRICE_CHANGE_SYNC_INBOX" set "Status" = $2 where "GlobalId" = $1`,
      batchInbox.GlobalId,
      result.finalStoreStatus,
    );

    return {
      received: true,
      message: "Resultado de Cambio de Precio recibido y guardado.",
      globalId: result.globalId,
      batchId: result.batchId,
      status: result.finalStoreStatus,
    };
  }

  // Rol VPS/REMOTO: expone a quien pregunte (el ORIGEN, via pull) el estado del batch en
  // ESTE nodo. Lee unicamente PRICE_CHANGE_SYNC_INBOX (lo que le fue reportado/recibido),
  // nunca PRICE_CHANGE_BATCH_STORE/_ITEM_RESULT directamente -- esas son del rol LOCAL
  // SERVICE y, si algun dia se separan fisicamente, el rol VPS/REMOTO no podria leerlas.
  async getPriceChangeRemoteStatus(batchId: string) {
    const current = this.getCurrentSourceContext();

    const batchInbox = await this.getPriceChangeSyncInboxRowForBatch(batchId, current.nodeId);
    const resultInbox = await this.getPriceChangeSyncInboxRowByGlobalId(
      this.buildPriceChangeResultGlobalId(current.nodeId, batchId),
    );

    if (!batchInbox && !resultInbox) {
      throw new NotFoundException(`Este nodo no tiene registro del Cambio de Precio ${batchId}.`);
    }

    if (resultInbox) {
      const payload = resultInbox.Payload as {
        finalStoreStatus?: string;
        counts?: unknown;
        itemResults?: unknown;
        reportedAt?: string;
      };
      return {
        batchId,
        destinationNodeId: current.nodeId,
        status: payload.finalStoreStatus ?? resultInbox.Status,
        counts: payload.counts ?? null,
        items: payload.itemResults ?? null,
        reportedAt: payload.reportedAt ?? null,
      };
    }

    // Se recibio el batch (Paso 3/4) pero el rol LOCAL SERVICE todavia no reporto
    // resultado -- "recibido, esperando a que la tienda aplique en su proximo refresh".
    return {
      batchId,
      destinationNodeId: current.nodeId,
      status: PRICE_CHANGE_BATCH_STATUS_WAITING_STORE_REFRESH,
      counts: null,
      items: null,
      reportedAt: null,
    };
  }

  // Rol ORIGEN: consulta (pull) por HTTP real el remote-status de cada tienda destino en
  // SENT_TO_VPS/WAITING_STORE_REFRESH -- las unicas que ya llegaron al VPS pero todavia no
  // tienen un desenlace terminal conocido por el origen. Nunca reconsulta FAILED_NETWORK
  // (eso es responsabilidad del retry de envio, Paso 3) ni estados ya terminales.
  async pullRemotePriceChangeStatus(batchId: string) {
    const current = this.getCurrentSourceContext();
    const batch = await this.getPriceChangeBatchRowOrThrow(batchId);
    this.assertBatchBelongsToCurrentOrigin(batch, current);

    const stores = await this.getPriceChangeBatchStoreRows(batchId);
    const eligible = stores.filter(
      (store) =>
        store.Status === PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS ||
        store.Status === PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH,
    );

    for (const store of eligible) {
      try {
        if (!store.ApiUrl) {
          throw new Error(`El nodo ${store.DestinationNodeId} no tiene una URL de sincronizacion configurada.`);
        }
        const remote = await this.fetchPriceChangeRemoteStatus(store.ApiUrl, batchId);
        await this.applyRemotePriceChangeStatusToStore(batchId, store, remote);
      } catch (error) {
        // Fallo de red al CONSULTAR estado nunca degrada un estado ya conocido -- solo se
        // registra el error para trazabilidad, el Status de la tienda no se toca.
        const message = this.extractPriceChangeErrorMessage(error);
        this.logger.warn(`No se pudo consultar remote-status de ${batchId} en ${store.DestinationNodeId}: ${message}`);
        await this.prisma.$executeRawUnsafe(
          `update dbo."PRICE_CHANGE_BATCH_STORE" set "LastError" = $3, "UpdatedAt" = now() where "BatchId" = $1 and "DestinationNodeId" = $2`,
          batchId,
          store.DestinationNodeId,
          message,
        );
      }
    }

    const finalStores = await this.getPriceChangeBatchStoreRows(batchId);
    const newBatchStatus = this.computePriceChangeApplyAggregateBatchStatus(finalStores);
    if (newBatchStatus) {
      await this.updatePriceChangeBatchStatus(batchId, newBatchStatus);
    }

    return {
      batchId,
      status: newBatchStatus ?? batch.Status,
      stores: finalStores.map((store) => this.toPriceChangeBatchStoreView(store)),
    };
  }

  // Opcional: hace pull de remote-status para TODOS los batches de este origen que
  // tengan alguna tienda en SENT_TO_VPS/WAITING_STORE_REFRESH.
  async pullRemotePriceChangeStatuses(limit = PRICE_CHANGE_DEFAULT_PULL_LIMIT) {
    const current = this.getCurrentSourceContext();
    const batchRows = await this.prisma.$queryRawUnsafe<Array<{ BatchId: string }>>(
      `
        select distinct b."BatchId" from dbo."PRICE_CHANGE_BATCH" b
        inner join dbo."PRICE_CHANGE_BATCH_STORE" s on s."BatchId" = b."BatchId"
        where upper(b."SourceNodeId") = upper($1) and s."Status" in ($2, $3)
        order by b."BatchId" asc
        limit $4
      `,
      current.nodeId,
      PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS,
      PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH,
      limit,
    );

    const results = [];
    for (const row of batchRows) {
      try {
        results.push(await this.pullRemotePriceChangeStatus(row.BatchId));
      } catch (error) {
        const message = this.extractPriceChangeErrorMessage(error);
        results.push({ batchId: row.BatchId, error: message });
      }
    }
    return { processed: results.length, results };
  }

  private assertSystemUser(user: UserView) {
    const isSystem = user.grupos.some((group) => String(group.codigo || "").trim().toUpperCase() === "SISTEMA");
    if (!isSystem) {
      throw new ConflictException("Solo el usuario sistema puede ejecutar el proceso de Cambio de Precio.");
    }
  }

  // Rol ORIGEN. Deriva la identidad del nodo actual a partir del nombre de la base en
  // DATABASE_URL, igual que getCurrentInstanceContext() en dev-returns.service.ts:2207-2247
  // (no hay un modulo compartido para esto en el repo, cada servicio lo re-implementa).
  private getCurrentSourceContext(): PriceChangeNodeContext {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    const databaseName = databaseUrl.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "";

    // Anclados al nombre COMPLETO de la base (^...$), no como substring: las bases del
    // VPS usan sufijo "_vps" (ej. rocky_tienda_002_vps, ver ACCESO_VPS_Y_GUIA_DE_BASES.md)
    // y un regex sin anclar clasificaria esa instancia igual que la tienda FISICA local
    // (rocky_tienda_002), armando por error el timer LOCAL SERVICE del Paso 8.5 en el rol
    // VPS/REMOTO -- exactamente lo que prohibe la Decision 1.
    const storeVpsMatch = databaseName.match(/^rocky_tienda_(\d+)_vps$/i);
    const storeLocalMatch = databaseName.match(/^rocky_tienda_(\d+)$/i);
    const warehouseVpsMatch = databaseName.match(/^rocky_bodega_(\d+)_vps$/i);
    const warehouseLocalMatch = databaseName.match(/^rocky_bodega_(\d+)$/i);

    if (storeVpsMatch) {
      const code = storeVpsMatch[1].padStart(3, "0");
      return {
        nodeId: `TIENDA${code}`,
        sucursalCodigo: code,
        nombre: `Tienda ${code} (VPS)`,
        tipo: "TIENDA",
        isVpsRemote: true,
      };
    }

    if (storeLocalMatch) {
      const code = storeLocalMatch[1].padStart(3, "0");
      return {
        nodeId: `TIENDA${code}`,
        sucursalCodigo: code,
        nombre: `Tienda ${code}`,
        tipo: "TIENDA",
        isVpsRemote: false,
      };
    }

    if (warehouseVpsMatch) {
      const code = warehouseVpsMatch[1].padStart(3, "0");
      return {
        nodeId: `BODEGA${code}`,
        sucursalCodigo: `B${code}`,
        nombre: `Bodega ${code} (VPS)`,
        tipo: "BODEGA",
        isVpsRemote: true,
      };
    }

    if (warehouseLocalMatch) {
      const code = warehouseLocalMatch[1].padStart(3, "0");
      return {
        nodeId: `BODEGA${code}`,
        sucursalCodigo: `B${code}`,
        nombre: `Bodega ${code}`,
        tipo: "BODEGA",
        isVpsRemote: false,
      };
    }

    // rocky_sync_central, rocky_maxx, o cualquier otro nombre no reconocido -> ORIGEN.
    // isVpsRemote=false aqui es irrelevante para el gating (ORIGEN ya esta excluido via
    // PRICE_CHANGE_ORIGIN_NODE_IDS), pero se deja explicito por consistencia del tipo.
    return {
      nodeId: DEFAULT_WAREHOUSE_NODE_ID,
      sucursalCodigo: DEFAULT_WAREHOUSE_NODE_ID,
      nombre: DEFAULT_WAREHOUSE_NODE_ID,
      tipo: "BODEGA",
      isVpsRemote: false,
    };
  }

  // Origen debe ser Bodega Central o Bodega 002 (Decision 2). El origen nunca viene del
  // cliente: siempre es "donde esta corriendo esta instancia", segun el plan aprobado.
  private assertOriginAllowed(): PriceChangeNodeContext {
    const current = this.getCurrentSourceContext();
    if (!PRICE_CHANGE_ORIGIN_NODE_IDS.has(current.nodeId)) {
      throw new ConflictException(
        "El proceso de Cambio de Precio solo puede iniciarse desde Bodega Central o Bodega 002.",
      );
    }
    return current;
  }

  // Backend SIEMPRE lee costos desde Inventario del nodo actual; el frontend nunca envia
  // costos, ni en modo SELECTED_ITEMS. En FULL_INVENTORY, codigosBarra se ignora aunque
  // el cliente lo envie.
  private async resolvePriceChangeItems(mode: PriceChangeMode, codigosBarra?: string[]) {
    const warnings: string[] = [];

    if (mode === PRICE_CHANGE_MODE_FULL_INVENTORY) {
      const items = await this.prisma.inventario.findMany({
        select: PRICE_CHANGE_ITEM_SELECT,
        orderBy: { CodigoBarra: "asc" },
      });
      return { items, warnings };
    }

    // SELECTED_ITEMS. La ausencia/vacio de codigos de barra individuales ya la rechaza el
    // DTO (@IsNotEmpty/@ArrayMinSize); aqui se detectan duplicados dentro de la seleccion.
    const requested = codigosBarra ?? [];
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const code of requested) {
      if (seen.has(code)) {
        duplicates.add(code);
      }
      seen.add(code);
    }
    if (duplicates.size > 0) {
      throw new BadRequestException(
        `Codigo(s) de barra duplicados en la seleccion: ${Array.from(duplicates).join(", ")}.`,
      );
    }

    const codes = Array.from(seen);
    const items = await this.prisma.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
      select: PRICE_CHANGE_ITEM_SELECT,
      orderBy: { CodigoBarra: "asc" },
    });

    const found = new Set(items.map((item) => item.CodigoBarra));
    const notFound = codes.filter((code) => !found.has(code));
    if (notFound.length > 0) {
      warnings.push(
        `No se encontraron en el inventario de origen y fueron omitidos: ${notFound.join(", ")}.`,
      );
    }

    return { items, warnings };
  }

  private toPriceChangeItemPreviewView(item: PriceChangeInventoryRow) {
    return {
      codigoBarra: item.CodigoBarra,
      nombre: item.Nombre,
      costoInicial: item.CostoInicial.toString(),
      costoPromedio: item.CostoPromedio.toString(),
      ultimoCosto: item.UltimoCosto.toString(),
      costoDolar: item.CostoDolar.toString(),
    };
  }

  private async insertPriceChangeBatchItems(
    tx: Prisma.TransactionClient,
    batchId: string,
    items: PriceChangeInventoryRow[],
  ) {
    // Sin "on conflict": batchId siempre es un UUID recien generado (createPriceChangeBatch)
    // y los items ya vienen deduplicados por Set/where-in, no hay riesgo real de choque de PK.
    return this.bulkInsertPriceChangeBatchItems(
      tx,
      batchId,
      items,
      (item) => ({
        codigoBarra: item.CodigoBarra,
        costoInicial: item.CostoInicial,
        costoPromedio: item.CostoPromedio,
        ultimoCosto: item.UltimoCosto,
        costoDolar: item.CostoDolar,
      }),
      { onConflictDoNothing: false },
    );
  }

  // Bulk-insert generico usado tanto por createPriceChangeBatch (items reales de
  // Inventario, PascalCase, sin riesgo de reentrada) como por receivePriceChangeBatchLocally
  // (items del payload de sync, camelCase, con "on conflict do nothing" por reentrada). Antes
  // eran dos copias casi identicas del mismo bucle de chunking/placeholders; se unifico aqui.
  private async bulkInsertPriceChangeBatchItems<T>(
    tx: Prisma.TransactionClient,
    batchId: string,
    items: T[],
    toRow: (item: T) => {
      codigoBarra: string;
      costoInicial: unknown;
      costoPromedio: unknown;
      ultimoCosto: unknown;
      costoDolar: unknown;
    },
    options: { onConflictDoNothing: boolean },
  ) {
    for (let offset = 0; offset < items.length; offset += PRICE_CHANGE_ITEM_INSERT_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + PRICE_CHANGE_ITEM_INSERT_CHUNK_SIZE);
      const valuePlaceholders: string[] = [];
      const params: unknown[] = [];

      chunk.forEach((rawItem, index) => {
        const row = toRow(rawItem);
        const base = index * 6;
        valuePlaceholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}::numeric, $${base + 4}::numeric, $${base + 5}::numeric, $${base + 6}::numeric)`,
        );
        params.push(
          batchId,
          row.codigoBarra,
          this.toDecimalString(row.costoInicial),
          this.toDecimalString(row.costoPromedio),
          this.toDecimalString(row.ultimoCosto),
          this.toDecimalString(row.costoDolar),
        );
      });

      await tx.$executeRawUnsafe(
        `
          insert into dbo."PRICE_CHANGE_BATCH_ITEM"
            ("BatchId", "CodigoBarra", "CostoInicial", "CostoPromedio", "UltimoCosto", "CostoDolar")
          values ${valuePlaceholders.join(", ")}
          ${options.onConflictDoNothing ? `on conflict ("BatchId", "CodigoBarra") do nothing` : ""}
        `,
        ...params,
      );
    }
  }

  // Destinos deben ser solo tiendas operativas (Tipo='TIENDA' en SYNC_NODES); Bodega
  // Central/Bodega 002 quedan explicitamente rechazadas como destino (Decision 2), igual
  // que el propio nodo origen.
  private async resolvePriceChangeDestinations(destinationNodeIds: string[], current: PriceChangeNodeContext) {
    const requestedIds = Array.from(new Set(destinationNodeIds));
    if (requestedIds.length === 0) {
      throw new BadRequestException("Debes seleccionar al menos una tienda destino.");
    }

    const rejectedAsOrigin = requestedIds.filter((nodeId) => PRICE_CHANGE_ORIGIN_NODE_IDS.has(nodeId));
    if (rejectedAsOrigin.length > 0) {
      throw new ConflictException(
        `Bodega Central y Bodega 002 solo pueden ser origen de Cambio de Precio, nunca destino: ${rejectedAsOrigin.join(", ")}.`,
      );
    }

    if (requestedIds.includes(current.nodeId)) {
      throw new BadRequestException("El destino no puede ser el mismo nodo de origen.");
    }

    const nodes = await this.prisma.$queryRawUnsafe<SyncNodeRow[]>(`
      select "NodeId", "SucursalCodigo", "Nombre", "Tipo", "ApiUrl", "CreatedAt", "UpdatedAt", "LastSeenAt"
      from dbo."SYNC_NODES"
    `);

    return requestedIds.map((nodeId) => {
      const node = nodes.find((item) => item.NodeId.toUpperCase() === nodeId.toUpperCase());
      if (!node) {
        throw new NotFoundException(`No existe el nodo destino ${nodeId} registrado en SYNC_NODES.`);
      }
      if ((node.Tipo || "").toUpperCase() !== "TIENDA") {
        throw new ConflictException(
          `El destino ${nodeId} no es una tienda operativa (Tipo=${node.Tipo ?? "desconocido"}).`,
        );
      }
      if (!node.ApiUrl) {
        throw new ConflictException(
          `El nodo ${nodeId} no tiene una URL de sincronizacion configurada (SYNC_NODES.ApiUrl).`,
        );
      }
      return node;
    });
  }

  private assertBatchBelongsToCurrentOrigin(batch: PriceChangeBatchRow, current: PriceChangeNodeContext) {
    if (batch.SourceNodeId.toUpperCase() !== current.nodeId.toUpperCase()) {
      throw new ConflictException("Este batch de Cambio de Precio no fue creado desde este nodo origen.");
    }
  }

  private async getPriceChangeBatchRowOrThrow(batchId: string) {
    const rows = await this.prisma.$queryRawUnsafe<PriceChangeBatchRow[]>(
      `select * from dbo."PRICE_CHANGE_BATCH" where "BatchId" = $1`,
      batchId,
    );
    if (!rows[0]) {
      throw new NotFoundException(`No existe el batch de Cambio de Precio ${batchId}.`);
    }
    return rows[0];
  }

  private async getPriceChangeBatchItemRows(batchId: string) {
    return this.prisma.$queryRawUnsafe<PriceChangeBatchItemRow[]>(
      `select * from dbo."PRICE_CHANGE_BATCH_ITEM" where "BatchId" = $1 order by "CodigoBarra" asc`,
      batchId,
    );
  }

  private async getPriceChangeBatchStoreRows(batchId: string) {
    return this.prisma.$queryRawUnsafe<PriceChangeBatchStoreRow[]>(
      `select * from dbo."PRICE_CHANGE_BATCH_STORE" where "BatchId" = $1 order by "DestinationNodeId" asc`,
      batchId,
    );
  }

  private async getPriceChangeSyncInboxRow(globalId: string) {
    const rows = await this.prisma.$queryRawUnsafe<{ GlobalId: string; Status: string }[]>(
      `select "GlobalId", "Status" from dbo."PRICE_CHANGE_SYNC_INBOX" where "GlobalId" = $1`,
      globalId,
    );
    return rows[0] ?? null;
  }

  // Cuerpo comun de sendPriceChangeBatch/retryPriceChangeBatchStores: marca el batch
  // SENDING_TO_VPS, intenta cada tienda elegible de forma independiente, y al final
  // recalcula el estado agregado del batch a partir del estado real de TODAS sus tiendas
  // (no solo las tocadas en esta corrida).
  private async runPriceChangeBatchSend(
    current: PriceChangeNodeContext,
    batch: PriceChangeBatchRow,
    items: PriceChangeBatchItemRow[],
    eligible: PriceChangeBatchStoreRow[],
  ) {
    await this.updatePriceChangeBatchStatus(batch.BatchId, PRICE_CHANGE_BATCH_STATUS_SENDING_TO_VPS);

    const outcomes = await this.attemptSendPriceChangeBatchToStores(current, batch, items, eligible);

    const finalStores = await this.getPriceChangeBatchStoreRows(batch.BatchId);
    // Un retry de una tienda FAILED_NETWORK no debe REGRESAR el batch si otras tiendas ya
    // tienen progreso de aplicacion (WAITING_STORE_REFRESH/APPLIED/PARTIAL_APPLIED/
    // FAILED_APPLY, puesto ahi por pullRemotePriceChangeStatus o por su propio Paso 5/6).
    // computePriceChangeBatchAggregateStatus (solo consciente de envio) por si sola
    // colapsaria eso de vuelta a SENT_TO_VPS; se le da prioridad al calculo de aplicacion
    // y solo se cae al de envio cuando ninguna tienda tiene progreso post-envio todavia.
    const finalStatus =
      this.computePriceChangeApplyAggregateBatchStatus(finalStores) ??
      this.computePriceChangeBatchAggregateStatus(finalStores);
    await this.updatePriceChangeBatchStatus(batch.BatchId, finalStatus);

    return this.buildPriceChangeBatchSendResult(
      { ...batch, Status: finalStatus },
      finalStores,
      {
        sentCount: outcomes.filter((outcome) => outcome.success).length,
        failedCount: outcomes.filter((outcome) => !outcome.success).length,
      },
    );
  }

  private async attemptSendPriceChangeBatchToStores(
    current: PriceChangeNodeContext,
    batch: PriceChangeBatchRow,
    items: PriceChangeBatchItemRow[],
    stores: PriceChangeBatchStoreRow[],
  ) {
    const outcomes: Array<{ destinationNodeId: string; success: boolean; error?: string }> = [];

    for (const store of stores) {
      const globalId = this.buildPriceChangeGlobalId(current.nodeId, batch.BatchId, store.DestinationNodeId);

      try {
        const apiUrl = await this.resolvePriceChangeDestinationApiUrl(store.DestinationNodeId);
        if (!apiUrl) {
          throw new Error(`El nodo ${store.DestinationNodeId} no tiene una URL de sincronizacion configurada.`);
        }

        const payload = this.buildPriceChangeSyncPayload({ globalId, current, batch, store, items });
        await this.recordPriceChangeSyncOutboxPending(
          globalId,
          batch.BatchId,
          current.nodeId,
          store.DestinationNodeId,
          payload,
        );

        await this.postPriceChangeSyncPackage(apiUrl, payload);

        await this.markPriceChangeSyncOutboxSent(globalId);
        await this.updatePriceChangeBatchStoreStatus(batch.BatchId, store.DestinationNodeId, {
          status: PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS,
          sentAt: true,
          lastError: null,
        });

        outcomes.push({ destinationNodeId: store.DestinationNodeId, success: true });
      } catch (error) {
        // Fallo de red, timeout, autenticacion o rechazo del remoto: se tratan todos como
        // FAILED_NETWORK a nivel de tienda porque el enum de 9 estados aprobado no define
        // un estado de fallo de validacion separado (ver instrucciones del paso 3).
        const message = this.extractPriceChangeErrorMessage(error);
        this.logger.warn(
          `No se pudo enviar Cambio de Precio ${batch.BatchId} a ${store.DestinationNodeId}: ${message}`,
        );

        await this.markPriceChangeSyncOutboxError(globalId, message);
        await this.updatePriceChangeBatchStoreStatus(batch.BatchId, store.DestinationNodeId, {
          status: PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK,
          lastError: message,
        });

        outcomes.push({ destinationNodeId: store.DestinationNodeId, success: false, error: message });
      }
    }

    return outcomes;
  }

  private async resolvePriceChangeDestinationApiUrl(destinationNodeId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ ApiUrl: string | null }>>(
      `select "ApiUrl" from dbo."SYNC_NODES" where upper("NodeId") = upper($1) limit 1`,
      destinationNodeId,
    );
    const apiUrl = rows[0]?.ApiUrl;
    return apiUrl && apiUrl.trim() ? apiUrl.trim() : null;
  }

  // Rol LOCAL SERVICE: resuelve la URL del PROPIO gemelo VPS/REMOTO de esta tienda -- NO
  // reutiliza resolvePriceChangeDestinationApiUrl(current.nodeId) (via SYNC_NODES) porque
  // esa fila se autosobrescribe en cada arranque: ensureLocalSyncNodeRegistration
  // (dev-returns.service.ts) hace upsert de SYNC_NODES.<mi-propio-NodeId>.ApiUrl con "como
  // me alcanzan a MI" (ej. http://localhost:3001), no con "donde esta mi propio VPS" -- son
  // dos conceptos distintos que hoy comparten la misma fila por nodeId. Se resuelve igual
  // que ya hace mirror-sync (que tiene exactamente el mismo problema "cual es mi upstream
  // propio"): variable de entorno estable, nunca escrita por ningun auto-registro.
  private resolveOwnPriceChangeRemoteApiUrl(_ownNodeId: string) {
    const explicit = String(this.configService.get<string>("PRICE_CHANGE_REMOTE_API_URL", "") || "").trim();
    if (explicit) {
      return explicit;
    }

    const mirrorFallback = String(this.configService.get<string>("MIRROR_SYNC_REMOTE_API_URL", "") || "").trim();
    return mirrorFallback || null;
  }

  private buildPriceChangeGlobalId(sourceNodeId: string, batchId: string, destinationNodeId: string) {
    return `${sourceNodeId}-PRC-${batchId}-${destinationNodeId}`;
  }

  // Payload autosuficiente: el destino puede guardarlo como pendiente sin volver a
  // consultar al origen (incluye todo lo que el rol LOCAL SERVICE necesitara para aplicar
  // mas adelante). No incluye checksum: el plan aprobado (Fase 3/4) no definio uno.
  private buildPriceChangeSyncPayload(params: {
    globalId: string;
    current: PriceChangeNodeContext;
    batch: PriceChangeBatchRow;
    store: PriceChangeBatchStoreRow;
    items: PriceChangeBatchItemRow[];
  }) {
    const { globalId, current, batch, store, items } = params;
    return {
      schemaVersion: 1,
      eventType: PRICE_CHANGE_SYNC_EVENT_BATCH,
      globalId,
      batchId: batch.BatchId,
      sourceNodeId: current.nodeId,
      sourceSucursalCodigo: current.sucursalCodigo,
      destinationNodeId: store.DestinationNodeId,
      destinationSucursalCodigo: store.DestinationCode,
      mode: batch.Mode,
      requestedBy: batch.RequestedBy,
      observacion: batch.Observacion,
      createdAt: batch.CreatedAt.toISOString(),
      totalItems: items.length,
      items: items.map((item) => ({
        codigoBarra: item.CodigoBarra,
        costoInicial: this.toDecimalString(item.CostoInicial),
        costoPromedio: this.toDecimalString(item.CostoPromedio),
        ultimoCosto: this.toDecimalString(item.UltimoCosto),
        costoDolar: this.toDecimalString(item.CostoDolar),
      })),
    };
  }

  private toDecimalString(value: unknown): string {
    if (value === null || value === undefined) {
      return "0";
    }
    return String(value);
  }

  private async recordPriceChangeSyncOutboxPending(
    globalId: string,
    batchId: string,
    sourceNodeId: string,
    destinationNodeId: string,
    payload: unknown,
  ) {
    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."PRICE_CHANGE_SYNC_OUTBOX"
          ("GlobalId", "BatchId", "SourceNodeId", "DestinationNodeId", "EventType", "Payload", "Status")
        values ($1, $2, $3, $4, $5, $6::jsonb, $7)
        on conflict ("GlobalId") do update set
          "Payload" = excluded."Payload",
          "Status" = excluded."Status"
      `,
      globalId,
      batchId,
      sourceNodeId,
      destinationNodeId,
      PRICE_CHANGE_SYNC_EVENT_BATCH,
      JSON.stringify(payload),
      PRICE_CHANGE_SYNC_STATUS_PENDING,
    );
  }

  private async markPriceChangeSyncOutboxSent(globalId: string) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."PRICE_CHANGE_SYNC_OUTBOX"
        set "Status" = $2, "SentAt" = now(), "Attempts" = "Attempts" + 1, "LastError" = null
        where "GlobalId" = $1
      `,
      globalId,
      PRICE_CHANGE_SYNC_STATUS_SENT,
    );
  }

  private async markPriceChangeSyncOutboxError(globalId: string, message: string) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."PRICE_CHANGE_SYNC_OUTBOX"
        set "Status" = $2, "Attempts" = "Attempts" + 1, "LastError" = $3
        where "GlobalId" = $1
      `,
      globalId,
      PRICE_CHANGE_SYNC_STATUS_PENDING,
      message,
    );
  }

  private async updatePriceChangeBatchStoreStatus(
    batchId: string,
    destinationNodeId: string,
    update: { status: string; lastError: string | null; sentAt?: boolean },
  ) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."PRICE_CHANGE_BATCH_STORE"
        set
          "Status" = $3,
          "Attempts" = "Attempts" + 1,
          "LastError" = $4,
          "SentAt" = case when $5 then now() else "SentAt" end,
          "UpdatedAt" = now()
        where "BatchId" = $1 and "DestinationNodeId" = $2
      `,
      batchId,
      destinationNodeId,
      update.status,
      update.lastError,
      Boolean(update.sentAt),
    );
  }

  private async updatePriceChangeBatchStatus(batchId: string, status: string) {
    await this.prisma.$executeRawUnsafe(
      `update dbo."PRICE_CHANGE_BATCH" set "Status" = $2, "UpdatedAt" = now() where "BatchId" = $1`,
      batchId,
      status,
    );
  }

  // DRAFT solo si nada se ha intentado enviar; SENT_TO_VPS si TODAS las tiendas llegaron
  // al menos a "enviada" (o mas alla); FAILED si TODAS quedaron en FAILED_NETWORK;
  // PARTIAL_SENT_TO_VPS en cualquier mezcla intermedia.
  private computePriceChangeBatchAggregateStatus(stores: PriceChangeBatchStoreRow[]): string {
    if (stores.length === 0) {
      return PRICE_CHANGE_BATCH_STATUS_FAILED;
    }

    const sentOrBeyond = new Set([
      PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS,
      PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH,
      PRICE_CHANGE_STORE_STATUS_RECEIVED_BY_STORE,
      PRICE_CHANGE_STORE_STATUS_APPLYING,
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
    ]);

    if (stores.every((store) => sentOrBeyond.has(store.Status))) {
      return PRICE_CHANGE_BATCH_STATUS_SENT_TO_VPS;
    }

    if (stores.every((store) => store.Status === PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK)) {
      return PRICE_CHANGE_BATCH_STATUS_FAILED;
    }

    if (stores.every((store) => store.Status === PRICE_CHANGE_STORE_STATUS_PENDING_SEND)) {
      return PRICE_CHANGE_BATCH_STATUS_DRAFT;
    }

    return PRICE_CHANGE_BATCH_STATUS_PARTIAL_SENT_TO_VPS;
  }

  private buildPriceChangeBatchSendResult(
    batch: PriceChangeBatchRow,
    stores: PriceChangeBatchStoreRow[],
    extra: { sentCount: number; failedCount: number; message?: string },
  ) {
    return {
      batchId: batch.BatchId,
      status: batch.Status,
      sentCount: extra.sentCount,
      failedCount: extra.failedCount,
      message: extra.message,
      stores: stores.map((store) => this.toPriceChangeBatchStoreView(store)),
    };
  }

  private toPriceChangeBatchStoreView(store: PriceChangeBatchStoreRow) {
    return {
      destinationNodeId: store.DestinationNodeId,
      destinationCode: store.DestinationCode,
      destinationName: store.DestinationName,
      status: store.Status,
      attempts: store.Attempts,
      lastError: store.LastError,
      sentAt: store.SentAt,
      appliedCount: store.AppliedCount,
      notFoundCount: store.NotFoundCount,
      duplicateSourceCount: store.DuplicateSourceCount,
      duplicateTargetCount: store.DuplicateTargetCount,
      invalidCount: store.InvalidCount,
      errorCount: store.ErrorCount,
    };
  }

  // --- HTTP hacia el rol VPS/REMOTO. Mismo patron (login tecnico + Bearer, sin libreria
  // HTTP, fetch nativo) que loginRemoteSyncNode/postTransferSyncPackage en
  // transfers.service.ts:1890-1937 -- no hay modulo compartido en el repo para esto
  // (Riesgo #3 del plan), asi que se re-implementa aqui igual que en cada modulo de sync.

  private async postPriceChangeSyncPackage(apiUrl: string, payload: unknown) {
    const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
    const token = await this.loginRemotePriceChangeNode(baseUrl);
    const response = await fetchWithTimeout(
      `${baseUrl}/api/price-changes/sync/import`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      PRICE_CHANGE_SYNC_REQUEST_TIMEOUT_MS,
    );

    const responseBody = await this.readRemoteJson(response);
    if (!response.ok) {
      throw new Error(`Destino rechazo el Cambio de Precio: ${this.formatRemoteError(responseBody, response.status)}`);
    }

    return responseBody;
  }

  private async loginRemotePriceChangeNode(baseUrl: string) {
    let lastErrorMessage = "Usuario o clave invalidos";
    let lastStatus = 401;

    for (const candidate of this.getPriceChangeRemoteCredentialCandidates()) {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(candidate),
        },
        PRICE_CHANGE_SYNC_REQUEST_TIMEOUT_MS,
      );
      const body = await this.readRemoteJson(response);

      if (response.ok && this.isRecord(body) && typeof body.accessToken === "string") {
        return body.accessToken;
      }

      lastErrorMessage = this.formatRemoteError(body, response.status);
      lastStatus = response.status;
    }

    throw new Error(`No se pudo autenticar contra el nodo destino: ${this.formatRemoteError(lastErrorMessage, lastStatus)}`);
  }

  // Mismas variables de entorno/orden de fallback que transfers.service.ts
  // (getRemoteSyncCredentialCandidates): reutiliza la cuenta tecnica de TRANSFER_SYNC_*,
  // no se inventa un par de credenciales nuevo solo para Cambio de Precio.
  private getPriceChangeRemoteCredentialCandidates() {
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private extractPriceChangeErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return "Error desconocido al sincronizar el Cambio de Precio.";
  }

  private normalizeRequiredApiUrl(value: unknown) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException("La URL del nodo debe comenzar con http:// o https://.");
    }
    return normalized;
  }

  // --- Rol VPS/REMOTO: normalizacion del payload entrante en POST /price-changes/sync/import.
  // No usa DTO con class-validator (igual que importTransferSyncPackage/importMirrorPayload):
  // es un endpoint inter-nodo, no de cliente/navegador.

  private normalizePriceChangeSyncPayload(body: Record<string, unknown>): PriceChangeSyncPayload {
    const globalId = this.normalizePriceChangeRequiredString(body.globalId, "globalId");
    const batchId = this.normalizePriceChangeRequiredString(body.batchId, "batchId");
    const sourceNodeId = this.normalizePriceChangeRequiredString(body.sourceNodeId, "sourceNodeId");
    const destinationNodeId = this.normalizePriceChangeRequiredString(body.destinationNodeId, "destinationNodeId");
    const mode = this.normalizePriceChangeRequiredString(body.mode, "mode");
    if (mode !== PRICE_CHANGE_MODE_SELECTED_ITEMS && mode !== PRICE_CHANGE_MODE_FULL_INVENTORY) {
      throw new BadRequestException(`Modo de Cambio de Precio invalido: ${mode}.`);
    }

    const rawItems = Array.isArray(body.items) ? body.items : null;
    if (!rawItems || rawItems.length === 0) {
      throw new BadRequestException("El batch de Cambio de Precio no trae articulos.");
    }

    const items = rawItems.map((raw, index) => {
      if (!this.isRecord(raw)) {
        throw new BadRequestException(`Articulo invalido en la posicion ${index}.`);
      }
      return {
        codigoBarra: this.normalizePriceChangeRequiredString(raw.codigoBarra, `items[${index}].codigoBarra`),
        costoInicial: this.normalizePriceChangeRequiredDecimalString(raw.costoInicial, `items[${index}].costoInicial`),
        costoPromedio: this.normalizePriceChangeRequiredDecimalString(raw.costoPromedio, `items[${index}].costoPromedio`),
        ultimoCosto: this.normalizePriceChangeRequiredDecimalString(raw.ultimoCosto, `items[${index}].ultimoCosto`),
        costoDolar: this.normalizePriceChangeRequiredDecimalString(raw.costoDolar, `items[${index}].costoDolar`),
      };
    });

    return { globalId, batchId, sourceNodeId, destinationNodeId, mode, items };
  }

  private normalizePriceChangeRequiredString(value: unknown, field: string) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      throw new BadRequestException(`Falta el campo requerido: ${field}.`);
    }
    return normalized;
  }

  private normalizePriceChangeRequiredDecimalString(value: unknown, field: string) {
    const normalized = String(value ?? "").trim();
    if (!normalized || Number.isNaN(Number(normalized))) {
      throw new BadRequestException(`Valor de costo invalido en ${field}.`);
    }
    return normalized;
  }

  // Rol LOCAL SERVICE: inserta localmente UN batch pendiente como RECEIVED_BY_STORE.
  // Idempotente por BatchId (PK de PRICE_CHANGE_BATCH): si ya existe localmente, no
  // reinserta nada (batch/items/store/resultados) y devuelve alreadyReceived=true. No
  // aplica costos, no toca Inventario, no reporta al VPS -- eso queda para el Paso 5.
  private async receivePriceChangeBatchLocally(inboxRow: PriceChangeSyncInboxRow) {
    const current = this.getCurrentSourceContext();
    const payload = this.normalizePriceChangeSyncPayload(inboxRow.Payload);

    if (payload.destinationNodeId.toUpperCase() !== current.nodeId.toUpperCase()) {
      throw new ConflictException(
        `El batch ${payload.globalId} esta dirigido a ${payload.destinationNodeId}, no a este nodo (${current.nodeId}).`,
      );
    }
    if (payload.globalId !== inboxRow.GlobalId) {
      throw new ConflictException(
        `El globalId del payload (${payload.globalId}) no coincide con el registro de inbox (${inboxRow.GlobalId}).`,
      );
    }

    const requestedBy = this.normalizePriceChangeRequiredString(inboxRow.Payload.requestedBy, "requestedBy");
    const observacion = typeof inboxRow.Payload.observacion === "string" ? inboxRow.Payload.observacion : null;

    return this.prisma.$transaction(async (tx) => {
      // Header local. Status='WAITING_STORE_REFRESH' es el valor mas cercano del enum de 8
      // estados de batch (Fase 3) al significado real de esta fila: "recibida, esperando a
      // que este nodo la aplique en su proximo refresh" -- no existe un valor de batch
      // literal "RECEIVED_BY_STORE" (ese es solo del enum de 9 estados por tienda).
      const inserted = await tx.$queryRawUnsafe<Array<{ BatchId: string }>>(
        `
          insert into dbo."PRICE_CHANGE_BATCH"
            ("BatchId", "SourceNodeId", "Mode", "Status", "RequestedBy", "Observacion", "TotalItems", "TotalStores")
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict ("BatchId") do nothing
          returning "BatchId"
        `,
        payload.batchId,
        payload.sourceNodeId,
        payload.mode,
        PRICE_CHANGE_BATCH_STATUS_WAITING_STORE_REFRESH,
        requestedBy,
        observacion,
        payload.items.length,
        1,
      );

      if (inserted.length === 0) {
        // Auto-sanacion: si el batch ya existia localmente pero PRICE_CHANGE_SYNC_INBOX
        // sigue en 'RECEIVED' aunque su PRICE_CHANGE_BATCH_STORE ya este en un estado
        // terminal (rastro del bug donde el inbox nunca se actualizaba al aplicar -- ver
        // finalizePriceChangeBatchAndStoreAfterApply), corregirlo aqui para liberar el cupo
        // del LIMIT en el proximo ciclo en vez de quedar "zombie" para siempre.
        const terminalStoreStatuses = new Set([
          PRICE_CHANGE_STORE_STATUS_APPLIED,
          PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
          PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
        ]);
        const storeRows = await tx.$queryRawUnsafe<Array<{ Status: string }>>(
          `select "Status" from dbo."PRICE_CHANGE_BATCH_STORE" where "BatchId" = $1 and "DestinationNodeId" = $2`,
          payload.batchId,
          current.nodeId,
        );
        const storeStatus = storeRows[0]?.Status;
        if (storeStatus && terminalStoreStatuses.has(storeStatus) && inboxRow.Status !== storeStatus) {
          await tx.$executeRawUnsafe(
            `update dbo."PRICE_CHANGE_SYNC_INBOX" set "Status" = $2 where "GlobalId" = $1`,
            inboxRow.GlobalId,
            storeStatus,
          );
        }

        return { globalId: payload.globalId, batchId: payload.batchId, received: false, alreadyReceived: true };
      }

      await this.insertPriceChangeBatchItemsFromPayload(tx, payload.batchId, payload.items);

      // Una sola fila de "store": este mismo nodo, representando su propio avance local.
      await tx.$executeRawUnsafe(
        `
          insert into dbo."PRICE_CHANGE_BATCH_STORE"
            ("BatchId", "DestinationNodeId", "DestinationCode", "DestinationName", "ApiUrl", "Status", "ReceivedAt")
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict ("BatchId", "DestinationNodeId") do nothing
        `,
        payload.batchId,
        current.nodeId,
        current.sucursalCodigo,
        current.nombre,
        null,
        PRICE_CHANGE_STORE_STATUS_RECEIVED_BY_STORE,
      );

      await this.insertPriceChangeBatchItemResultsPending(tx, payload.batchId, current.nodeId, payload.items);

      return { globalId: payload.globalId, batchId: payload.batchId, received: true };
    });
  }

  private async insertPriceChangeBatchItemsFromPayload(
    tx: Prisma.TransactionClient,
    batchId: string,
    items: PriceChangeSyncPayloadItem[],
  ) {
    // "on conflict do nothing": este path si es reentrante (reintentos/crash recovery de
    // receivePriceChangeBatchLocally), a diferencia de insertPriceChangeBatchItems.
    return this.bulkInsertPriceChangeBatchItems(
      tx,
      batchId,
      items,
      (item) => ({
        codigoBarra: item.codigoBarra,
        costoInicial: item.costoInicial,
        costoPromedio: item.costoPromedio,
        ultimoCosto: item.ultimoCosto,
        costoDolar: item.costoDolar,
      }),
      { onConflictDoNothing: true },
    );
  }

  // Filas placeholder de trazabilidad (Status='PENDING', el default de la columna) para
  // que el Paso 5 tenga una fila por articulo que actualizar en vez de insertar.
  private async insertPriceChangeBatchItemResultsPending(
    tx: Prisma.TransactionClient,
    batchId: string,
    destinationNodeId: string,
    items: PriceChangeSyncPayloadItem[],
  ) {
    for (let offset = 0; offset < items.length; offset += PRICE_CHANGE_ITEM_INSERT_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + PRICE_CHANGE_ITEM_INSERT_CHUNK_SIZE);
      const valuePlaceholders: string[] = [];
      const params: unknown[] = [];

      chunk.forEach((item, index) => {
        const base = index * 4;
        valuePlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        params.push(batchId, destinationNodeId, item.codigoBarra, PRICE_CHANGE_ITEM_RESULT_STATUS_PENDING);
      });

      await tx.$executeRawUnsafe(
        `
          insert into dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"
            ("BatchId", "DestinationNodeId", "CodigoBarra", "Status")
          values ${valuePlaceholders.join(", ")}
          on conflict ("BatchId", "DestinationNodeId", "CodigoBarra") do nothing
        `,
        ...params,
      );
    }
  }

  private async getPriceChangeBatchStoreRowForNode(batchId: string, destinationNodeId: string) {
    const rows = await this.prisma.$queryRawUnsafe<PriceChangeBatchStoreRow[]>(
      `select * from dbo."PRICE_CHANGE_BATCH_STORE" where "BatchId" = $1 and upper("DestinationNodeId") = upper($2)`,
      batchId,
      destinationNodeId,
    );
    return rows[0] ?? null;
  }

  private async getPriceChangeSyncInboxRowForBatch(batchId: string, destinationNodeId: string) {
    const rows = await this.prisma.$queryRawUnsafe<PriceChangeSyncInboxRow[]>(
      `
        select "GlobalId", "BatchId", "SourceNodeId", "DestinationNodeId", "EventType", "Payload", "Status", "ReceivedAt", "AppliedAt", "Attempts", "LastError"
        from dbo."PRICE_CHANGE_SYNC_INBOX"
        where "BatchId" = $1 and upper("DestinationNodeId") = upper($2)
        limit 1
      `,
      batchId,
      destinationNodeId,
    );
    return rows[0] ?? null;
  }

  // Duplicados de codigo de barra dentro del payload CRUDO que envio el origen (no contra
  // PRICE_CHANGE_BATCH_ITEM, que ya llega deduplicado por su propia PK -- ver comentario
  // en applyLocalPriceChangeBatch).
  private extractDuplicateSourceCodes(payload: Record<string, unknown>): Set<string> {
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const counts = new Map<string, number>();

    for (const raw of rawItems) {
      if (!this.isRecord(raw)) {
        continue;
      }
      const code = typeof raw.codigoBarra === "string" ? raw.codigoBarra.trim() : "";
      if (!code) {
        continue;
      }
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    const duplicates = new Set<string>();
    for (const [code, count] of counts) {
      if (count > 1) {
        duplicates.add(code);
      }
    }
    return duplicates;
  }

  private async updatePriceChangeBatchStoreStatusOnly(batchId: string, destinationNodeId: string, status: string) {
    await this.prisma.$executeRawUnsafe(
      `update dbo."PRICE_CHANGE_BATCH_STORE" set "Status" = $3, "UpdatedAt" = now() where "BatchId" = $1 and "DestinationNodeId" = $2`,
      batchId,
      destinationNodeId,
      status,
    );
  }

  private async getPriceChangePendingItemResults(batchId: string, destinationNodeId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ CodigoBarra: string }>>(
      `
        select "CodigoBarra" from dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"
        where "BatchId" = $1 and "DestinationNodeId" = $2 and "Status" = $3
        order by "CodigoBarra" asc
      `,
      batchId,
      destinationNodeId,
      PRICE_CHANGE_ITEM_RESULT_STATUS_PENDING,
    );
    return rows.map((row) => row.CodigoBarra);
  }

  // Una transaccion CORTA por articulo (no una transaccion gigante por batch): un error en
  // un articulo no debe abortar ni bloquear a los demas, y con un lote de miles de
  // articulos (FULL_INVENTORY) no conviene mantener un solo lock largo. Cada rama termina
  // escribiendo su resultado final en PRICE_CHANGE_BATCH_ITEM_RESULT dentro de la MISMA
  // transaccion que decide el resultado (o en una transaccion nueva si la de aplicacion
  // fallo, ya que Postgres aborta el resto de sentencias de una transaccion tras un error).
  private async applyOnePriceChangeItem(
    batchId: string,
    destinationNodeId: string,
    codigoBarra: string,
    itemsByCode: Map<string, PriceChangeBatchItemRow>,
    duplicateSourceCodes: Set<string>,
  ): Promise<string> {
    // 4. Barcode invalido (vacio/null). En el flujo normal esto no deberia ocurrir --
    // normalizePriceChangeSyncPayload ya rechaza el payload completo si algun barcode
    // llega vacio (Paso 3/4) -- se deja como defensa para payloads que no pasaron por ahi.
    if (!codigoBarra || !codigoBarra.trim()) {
      return this.prisma.$transaction((tx) =>
        this.finalizePriceChangeItemResult(
          tx,
          batchId,
          destinationNodeId,
          codigoBarra,
          PRICE_CHANGE_ITEM_RESULT_STATUS_INVALID_BARCODE,
        ),
      );
    }

    // 5. Duplicado en el payload de origen.
    if (duplicateSourceCodes.has(codigoBarra)) {
      return this.prisma.$transaction((tx) =>
        this.finalizePriceChangeItemResult(
          tx,
          batchId,
          destinationNodeId,
          codigoBarra,
          PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_SOURCE_BARCODE,
        ),
      );
    }

    const item = itemsByCode.get(codigoBarra);
    if (!item) {
      // No deberia pasar (el result row viene de PRICE_CHANGE_BATCH_ITEM), pero se trata
      // como ERROR en vez de asumir un costo inexistente.
      return this.prisma.$transaction((tx) =>
        this.finalizePriceChangeItemResult(
          tx,
          batchId,
          destinationNodeId,
          codigoBarra,
          PRICE_CHANGE_ITEM_RESULT_STATUS_ERROR,
          "No se encontraron los costos capturados para este articulo.",
        ),
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 6/7. Match ESTRICTO por CodigoBarra exacto: igualdad simple, sin LIKE, sin
        // upper/trim, sin codigo interno. Se usa un select (no findUnique) a proposito
        // para poder detectar defensivamente >1 fila anomala aunque CodigoBarra sea @id.
        const matches = await tx.$queryRawUnsafe<Array<{ CodigoBarra: string }>>(
          `select "CodigoBarra" from dbo."INVENTARIO" where "CodigoBarra" = $1`,
          codigoBarra,
        );

        if (matches.length === 0) {
          return this.finalizePriceChangeItemResult(
            tx,
            batchId,
            destinationNodeId,
            codigoBarra,
            PRICE_CHANGE_ITEM_RESULT_STATUS_NOT_FOUND,
          );
        }

        if (matches.length > 1) {
          return this.finalizePriceChangeItemResult(
            tx,
            batchId,
            destinationNodeId,
            codigoBarra,
            PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_TARGET_BARCODE,
          );
        }

        // 8. Actualizar SOLO los 4 costos aprobados (+ UltimaActualizacion, campo tecnico
        // que TODA escritura a Inventario del repo ya setea -- ver transfers/dev-returns/
        // inventory/compras/mirror-sync.service.ts). Strings -> Prisma.Decimal, nunca
        // Number, para no perder exactitud.
        await tx.inventario.update({
          where: { CodigoBarra: codigoBarra },
          data: {
            CostoInicial: this.toDecimalString(item.CostoInicial),
            CostoPromedio: this.toDecimalString(item.CostoPromedio),
            UltimoCosto: this.toDecimalString(item.UltimoCosto),
            CostoDolar: this.toDecimalString(item.CostoDolar),
            UltimaActualizacion: new Date(),
          },
        });

        return this.finalizePriceChangeItemResult(
          tx,
          batchId,
          destinationNodeId,
          codigoBarra,
          PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED,
          undefined,
          {
            costoInicial: item.CostoInicial,
            costoPromedio: item.CostoPromedio,
            ultimoCosto: item.UltimoCosto,
            costoDolar: item.CostoDolar,
          },
        );
      });
    } catch (error) {
      // La transaccion de arriba ya fue revertida por Prisma/Postgres al fallar -- se
      // registra el error en una transaccion NUEVA e independiente (reutilizar el cliente
      // de la transaccion abortada fallaria con "current transaction is aborted").
      const message = this.extractPriceChangeErrorMessage(error);
      this.logger.warn(`Error aplicando Cambio de Precio ${batchId} / ${codigoBarra}: ${message}`);
      return this.prisma.$transaction((tx) =>
        this.finalizePriceChangeItemResult(
          tx,
          batchId,
          destinationNodeId,
          codigoBarra,
          PRICE_CHANGE_ITEM_RESULT_STATUS_ERROR,
          message,
        ),
      );
    }
  }

  private async finalizePriceChangeItemResult(
    tx: Prisma.TransactionClient,
    batchId: string,
    destinationNodeId: string,
    codigoBarra: string,
    status: string,
    errorMessage?: string,
    appliedCosts?: { costoInicial: unknown; costoPromedio: unknown; ultimoCosto: unknown; costoDolar: unknown },
  ) {
    await tx.$executeRawUnsafe(
      `
        update dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"
        set
          "Status" = $4,
          "ErrorMessage" = $5,
          "AppliedCostoInicial" = $6::numeric,
          "AppliedCostoPromedio" = $7::numeric,
          "AppliedUltimoCosto" = $8::numeric,
          "AppliedCostoDolar" = $9::numeric,
          "AppliedAt" = case when $4 = $10 then now() else "AppliedAt" end
        where "BatchId" = $1 and "DestinationNodeId" = $2 and "CodigoBarra" = $3
      `,
      batchId,
      destinationNodeId,
      codigoBarra,
      status,
      errorMessage ?? null,
      appliedCosts ? this.toDecimalString(appliedCosts.costoInicial) : null,
      appliedCosts ? this.toDecimalString(appliedCosts.costoPromedio) : null,
      appliedCosts ? this.toDecimalString(appliedCosts.ultimoCosto) : null,
      appliedCosts ? this.toDecimalString(appliedCosts.costoDolar) : null,
      PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED,
    );
    return status;
  }

  private async getPriceChangeItemResultRows(batchId: string, destinationNodeId: string) {
    return this.prisma.$queryRawUnsafe<PriceChangeItemResultRow[]>(
      `
        select "CodigoBarra", "Status", "ErrorMessage" from dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"
        where "BatchId" = $1 and "DestinationNodeId" = $2
        order by "CodigoBarra" asc
      `,
      batchId,
      destinationNodeId,
    );
  }

  // Igual que getPriceChangeItemResultRows pero incluye los 4 costos "aplicados"
  // (AppliedCostoInicial/Promedio/Ultimo/Dolar) -- solo el reporte PDF los necesita, el
  // resto del servicio trabaja con CodigoBarra/Status/ErrorMessage nada mas.
  private async getPriceChangeItemResultRowsWithCosts(batchId: string, destinationNodeId: string) {
    // Cast ::text explicito (solo en esta consulta, especifica del reporte): sin el, un
    // numeric leido via $queryRawUnsafe a veces vuelve como JS number y pierde ceros
    // decimales finales (20.00 -> "20") aunque el valor matematico siga siendo exacto. No
    // se toca getPriceChangeBatchItemRows (query compartida por los pasos 2/3/5) para no
    // arriesgar comportamiento ya probado fuera del alcance de este paso.
    return this.prisma.$queryRawUnsafe<
      Array<{
        CodigoBarra: string;
        Status: string;
        ErrorMessage: string | null;
        AppliedCostoInicial: unknown;
        AppliedCostoPromedio: unknown;
        AppliedUltimoCosto: unknown;
        AppliedCostoDolar: unknown;
      }>
    >(
      `
        select "CodigoBarra", "Status", "ErrorMessage",
          "AppliedCostoInicial"::text as "AppliedCostoInicial",
          "AppliedCostoPromedio"::text as "AppliedCostoPromedio",
          "AppliedUltimoCosto"::text as "AppliedUltimoCosto",
          "AppliedCostoDolar"::text as "AppliedCostoDolar"
        from dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"
        where "BatchId" = $1 and "DestinationNodeId" = $2
        order by "CodigoBarra" asc
      `,
      batchId,
      destinationNodeId,
    );
  }

  private async findSyncNodeById(nodeId: string) {
    const rows = await this.prisma.$queryRawUnsafe<SyncNodeRow[]>(
      `
        select "NodeId", "SucursalCodigo", "Nombre", "Tipo", "ApiUrl", "CreatedAt", "UpdatedAt", "LastSeenAt"
        from dbo."SYNC_NODES"
        where upper("NodeId") = upper($1)
        limit 1
      `,
      nodeId,
    );
    return rows[0] ?? null;
  }

  private summarizePriceChangeItemResults(rows: PriceChangeItemResultRow[]): PriceChangeItemResultCounts {
    return {
      appliedCount: rows.filter((row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED).length,
      notFoundCount: rows.filter((row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_NOT_FOUND).length,
      invalidBarcodeCount: rows.filter((row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_INVALID_BARCODE).length,
      duplicateSourceBarcodeCount: rows.filter(
        (row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_SOURCE_BARCODE,
      ).length,
      duplicateTargetBarcodeCount: rows.filter(
        (row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_DUPLICATE_TARGET_BARCODE,
      ).length,
      errorCount: rows.filter((row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_ERROR).length,
      pendingCount: rows.filter((row) => row.Status === PRICE_CHANGE_ITEM_RESULT_STATUS_PENDING).length,
    };
  }

  // "Ninguno aplico" -> FAILED_APPLY, "todos aplicaron" -> APPLIED, cualquier mezcla ->
  // PARTIAL_APPLIED. Igual regla simple que computePriceChangeBatchAggregateStatus en el
  // Paso 3, aplicada ahora a resultados de aplicacion en vez de resultados de envio.
  private computePriceChangeApplyStoreStatus(counts: PriceChangeItemResultCounts, totalItems: number): string {
    if (counts.appliedCount === totalItems) {
      return PRICE_CHANGE_STORE_STATUS_APPLIED;
    }
    if (counts.appliedCount === 0) {
      return PRICE_CHANGE_STORE_STATUS_FAILED_APPLY;
    }
    return PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED;
  }

  private computePriceChangeApplyBatchStatus(counts: PriceChangeItemResultCounts, totalItems: number): string {
    if (counts.appliedCount === totalItems) {
      return PRICE_CHANGE_BATCH_STATUS_APPLIED;
    }
    if (counts.appliedCount === 0) {
      return PRICE_CHANGE_BATCH_STATUS_FAILED;
    }
    return PRICE_CHANGE_BATCH_STATUS_PARTIAL_APPLIED;
  }

  private async finalizePriceChangeBatchAndStoreAfterApply(
    batchId: string,
    destinationNodeId: string,
    storeStatus: string,
    batchStatus: string,
    counts: PriceChangeItemResultCounts,
  ) {
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."PRICE_CHANGE_BATCH_STORE"
        set
          "Status" = $3,
          "AppliedAt" = case when $3 in ($4, $5) then now() else "AppliedAt" end,
          "AppliedCount" = $6,
          "NotFoundCount" = $7,
          "InvalidCount" = $8,
          "DuplicateSourceCount" = $9,
          "DuplicateTargetCount" = $10,
          "ErrorCount" = $11,
          "UpdatedAt" = now()
        where "BatchId" = $1 and "DestinationNodeId" = $2
      `,
      batchId,
      destinationNodeId,
      storeStatus,
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      counts.appliedCount,
      counts.notFoundCount,
      counts.invalidBarcodeCount,
      counts.duplicateSourceBarcodeCount,
      counts.duplicateTargetBarcodeCount,
      counts.errorCount,
    );

    await this.prisma.$executeRawUnsafe(
      `update dbo."PRICE_CHANGE_BATCH" set "Status" = $2, "UpdatedAt" = now() where "BatchId" = $1`,
      batchId,
      batchStatus,
    );

    // Fix: sin esto, PRICE_CHANGE_SYNC_INBOX se quedaba en 'RECEIVED' para siempre aunque
    // el batch ya estuviera aplicado -- las filas "zombie" (ya resueltas pero marcadas como
    // pendientes) llenaban el LIMIT del ciclo local (listPendingPriceChangeSyncForCurrentNode
    // ordena por ReceivedAt asc), impidiendo que llegaran nuevos batches genuinamente
    // pendientes una vez se acumulaban mas zombies que el limite del ciclo.
    await this.prisma.$executeRawUnsafe(
      `
        update dbo."PRICE_CHANGE_SYNC_INBOX"
        set "Status" = $3, "AppliedAt" = case when $3 in ($4, $5) then now() else "AppliedAt" end
        where "BatchId" = $1 and "DestinationNodeId" = $2 and "EventType" = 'PRICE_CHANGE_BATCH'
      `,
      batchId,
      destinationNodeId,
      storeStatus,
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
    );
  }

  private buildPriceChangeApplyResult(
    batch: PriceChangeBatchRow,
    store: PriceChangeBatchStoreRow,
    itemResultRows: PriceChangeItemResultRow[],
    globalId?: string,
    extra?: { message?: string },
  ) {
    const includeDetail = itemResultRows.length > 0 && itemResultRows.length <= 200;
    return {
      batchId: batch.BatchId,
      globalId: globalId ?? null,
      batchStatus: batch.Status,
      storeStatus: store.Status,
      totalItems: batch.TotalItems,
      appliedCount: store.AppliedCount,
      notFoundCount: store.NotFoundCount,
      invalidBarcodeCount: store.InvalidCount,
      duplicateSourceBarcodeCount: store.DuplicateSourceCount,
      duplicateTargetBarcodeCount: store.DuplicateTargetCount,
      errorCount: store.ErrorCount,
      message: extra?.message,
      items: includeDetail
        ? itemResultRows.map((row) => ({ codigoBarra: row.CodigoBarra, status: row.Status, errorMessage: row.ErrorMessage }))
        : undefined,
    };
  }

  private buildPriceChangeResultGlobalId(destinationNodeId: string, batchId: string) {
    return `${destinationNodeId}-PRC-RESULT-${batchId}`;
  }

  private async getPriceChangeSyncInboxRowByGlobalId(globalId: string) {
    const rows = await this.prisma.$queryRawUnsafe<PriceChangeSyncInboxRow[]>(
      `
        select "GlobalId", "BatchId", "SourceNodeId", "DestinationNodeId", "EventType", "Payload", "Status", "ReceivedAt", "AppliedAt", "Attempts", "LastError"
        from dbo."PRICE_CHANGE_SYNC_INBOX"
        where "GlobalId" = $1
      `,
      globalId,
    );
    return rows[0] ?? null;
  }

  // Rol VPS/REMOTO: normalizacion del payload de resultado entrante. Igual criterio que
  // normalizePriceChangeSyncPayload (Paso 3): endpoint inter-nodo, no de cliente/navegador,
  // asi que no usa DTO con class-validator.
  private normalizePriceChangeResultPayload(body: Record<string, unknown>) {
    const globalId = this.normalizePriceChangeRequiredString(body.globalId, "globalId");
    const batchId = this.normalizePriceChangeRequiredString(body.batchId, "batchId");
    const sourceNodeId = this.normalizePriceChangeRequiredString(body.sourceNodeId, "sourceNodeId");
    const destinationNodeId = this.normalizePriceChangeRequiredString(body.destinationNodeId, "destinationNodeId");
    const finalStoreStatus = this.normalizePriceChangeRequiredString(body.finalStoreStatus, "finalStoreStatus");

    const validStoreStatuses = new Set([
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
    ]);
    if (!validStoreStatuses.has(finalStoreStatus)) {
      throw new BadRequestException(`finalStoreStatus invalido: ${finalStoreStatus}.`);
    }

    return { globalId, batchId, sourceNodeId, destinationNodeId, finalStoreStatus };
  }

  private async fetchPriceChangeRemoteStatus(apiUrl: string, batchId: string) {
    const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
    const token = await this.loginRemotePriceChangeNode(baseUrl);
    const response = await fetchWithTimeout(
      `${baseUrl}/api/price-changes/${batchId}/remote-status`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      PRICE_CHANGE_SYNC_REQUEST_TIMEOUT_MS,
    );

    const responseBody = await this.readRemoteJson(response);
    if (!response.ok) {
      throw new Error(`No se pudo consultar remote-status: ${this.formatRemoteError(responseBody, response.status)}`);
    }
    if (!this.isRecord(responseBody)) {
      throw new Error("Respuesta invalida de remote-status.");
    }
    return responseBody;
  }

  // Rol ORIGEN: aplica lo que respondio el remote-status de UNA tienda a su copia local
  // de PRICE_CHANGE_BATCH_STORE (+ PRICE_CHANGE_BATCH_ITEM_RESULT como vista consolidada
  // de los resultados remotos, upsert por (BatchId, DestinationNodeId, CodigoBarra)).
  private async applyRemotePriceChangeStatusToStore(
    batchId: string,
    store: PriceChangeBatchStoreRow,
    remote: Record<string, unknown>,
  ) {
    const remoteStatus = typeof remote.status === "string" ? remote.status : null;
    if (!remoteStatus) {
      return;
    }

    const terminalStatuses = new Set([
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
    ]);

    if (terminalStatuses.has(remoteStatus)) {
      const counts = this.isRecord(remote.counts) ? remote.counts : {};
      await this.prisma.$executeRawUnsafe(
        `
          update dbo."PRICE_CHANGE_BATCH_STORE"
          set
            "Status" = $3,
            "AppliedAt" = now(),
            "AppliedCount" = $4,
            "NotFoundCount" = $5,
            "InvalidCount" = $6,
            "DuplicateSourceCount" = $7,
            "DuplicateTargetCount" = $8,
            "ErrorCount" = $9,
            "LastError" = null,
            "UpdatedAt" = now()
          where "BatchId" = $1 and "DestinationNodeId" = $2
        `,
        batchId,
        store.DestinationNodeId,
        remoteStatus,
        this.toSafeInt(counts.appliedCount),
        this.toSafeInt(counts.notFoundCount),
        this.toSafeInt(counts.invalidBarcodeCount),
        this.toSafeInt(counts.duplicateSourceBarcodeCount),
        this.toSafeInt(counts.duplicateTargetBarcodeCount),
        this.toSafeInt(counts.errorCount),
      );

      const items = Array.isArray(remote.items) ? remote.items : [];
      for (const raw of items) {
        if (!this.isRecord(raw)) {
          continue;
        }
        const codigoBarra = typeof raw.codigoBarra === "string" ? raw.codigoBarra : null;
        if (!codigoBarra) {
          continue;
        }
        const itemStatus = typeof raw.status === "string" ? raw.status : PRICE_CHANGE_ITEM_RESULT_STATUS_ERROR;
        const errorMessage = typeof raw.errorMessage === "string" ? raw.errorMessage : null;

        await this.prisma.$executeRawUnsafe(
          `
            insert into dbo."PRICE_CHANGE_BATCH_ITEM_RESULT" ("BatchId", "DestinationNodeId", "CodigoBarra", "Status", "ErrorMessage")
            values ($1, $2, $3, $4, $5)
            on conflict ("BatchId", "DestinationNodeId", "CodigoBarra") do update set
              "Status" = excluded."Status",
              "ErrorMessage" = excluded."ErrorMessage",
              "AppliedAt" = case when excluded."Status" = $6 then now() else dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"."AppliedAt" end
          `,
          batchId,
          store.DestinationNodeId,
          codigoBarra,
          itemStatus,
          errorMessage,
          PRICE_CHANGE_ITEM_RESULT_STATUS_APPLIED,
        );
      }
      return;
    }

    // Remoto todavia no reporto resultado (esta "recibido, esperando aplicar"): si el
    // origen lo tenia en SENT_TO_VPS, avanzarlo a WAITING_STORE_REFRESH. Nunca degradar
    // un estado ya terminal (APPLIED/PARTIAL_APPLIED/FAILED_APPLY no se tocan aqui).
    if (store.Status === PRICE_CHANGE_STORE_STATUS_SENT_TO_VPS) {
      await this.prisma.$executeRawUnsafe(
        `update dbo."PRICE_CHANGE_BATCH_STORE" set "Status" = $3, "LastError" = null, "UpdatedAt" = now() where "BatchId" = $1 and "DestinationNodeId" = $2`,
        batchId,
        store.DestinationNodeId,
        PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH,
      );
    }
  }

  private toSafeInt(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  // Agrega el estado del batch a partir del estado real de TODAS sus tiendas, incluyendo
  // ahora los desenlaces de aplicacion (no solo de envio, a diferencia de
  // computePriceChangeBatchAggregateStatus del Paso 3). Devuelve null cuando ninguna
  // tienda tiene progreso post-envio todavia -- en ese caso no se toca el Status actual
  // del batch (evita pisar un SENT_TO_VPS/PARTIAL_SENT_TO_VPS valido del Paso 3).
  private computePriceChangeApplyAggregateBatchStatus(stores: PriceChangeBatchStoreRow[]): string | null {
    if (stores.length === 0) {
      return null;
    }

    if (stores.every((store) => store.Status === PRICE_CHANGE_STORE_STATUS_APPLIED)) {
      return PRICE_CHANGE_BATCH_STATUS_APPLIED;
    }

    const doneStatuses = new Set([
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
      PRICE_CHANGE_STORE_STATUS_FAILED_NETWORK,
    ]);
    if (stores.every((store) => doneStatuses.has(store.Status))) {
      const anyApplied = stores.some(
        (store) =>
          store.Status === PRICE_CHANGE_STORE_STATUS_APPLIED || store.Status === PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      );
      return anyApplied ? PRICE_CHANGE_BATCH_STATUS_PARTIAL_APPLIED : PRICE_CHANGE_BATCH_STATUS_FAILED;
    }

    const progressStatuses = new Set([
      PRICE_CHANGE_STORE_STATUS_APPLIED,
      PRICE_CHANGE_STORE_STATUS_PARTIAL_APPLIED,
      PRICE_CHANGE_STORE_STATUS_FAILED_APPLY,
      PRICE_CHANGE_STORE_STATUS_WAITING_STORE_REFRESH,
    ]);
    if (stores.some((store) => progressStatuses.has(store.Status))) {
      return PRICE_CHANGE_BATCH_STATUS_WAITING_STORE_REFRESH;
    }

    return null;
  }

  private async ensurePriceChangeSyncSchema() {
    // SYNC_NODES es la misma tabla fisica que ya usan transfers.service.ts y
    // dev-returns.service.ts. Siguiendo el patron existente en el repo, cada modulo la
    // re-declara de forma idempotente (no hay un registro de nodos compartido en codigo).
    await this.prisma.$executeRawUnsafe(`
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

    await this.prisma.$executeRawUnsafe(`
      create unique index if not exists "UX_SYNC_NODES_SucursalCodigo"
      on dbo."SYNC_NODES" ("SucursalCodigo")
    `);

    await this.prisma.$executeRawUnsafe(`
      alter table dbo."SYNC_NODES"
      add column if not exists "ApiUrl" varchar(200)
    `);

    // Header del batch (rol ORIGEN).
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."PRICE_CHANGE_BATCH" (
        "BatchId" varchar(80) primary key,
        "SourceNodeId" text not null,
        "Mode" varchar(20) not null,
        "Status" varchar(30) not null default 'DRAFT',
        "RequestedBy" varchar(30) not null,
        "Observacion" varchar(250),
        "TotalItems" integer not null default 0,
        "TotalStores" integer not null default 0,
        "CreatedAt" timestamptz not null default now(),
        "UpdatedAt" timestamptz not null default now()
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_PRICE_CHANGE_BATCH_Status"
      on dbo."PRICE_CHANGE_BATCH" ("Status", "CreatedAt")
    `);

    // Costos capturados del origen al crear el batch (una vez, compartidos por todas las
    // tiendas destino). Nunca se llenan con valores enviados por el frontend.
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."PRICE_CHANGE_BATCH_ITEM" (
        "BatchId" varchar(80) not null,
        "CodigoBarra" varchar(30) not null,
        "CostoInicial" numeric not null,
        "CostoPromedio" numeric not null,
        "UltimoCosto" numeric not null,
        "CostoDolar" numeric not null,
        primary key ("BatchId", "CodigoBarra")
      )
    `);

    // Una fila por tienda destino (rol ORIGEN, vista consolidada via pull a
    // GET .../remote-status). Analoga a INVENTORY_BULK_SYNC_JOBS en transfers.service.ts.
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."PRICE_CHANGE_BATCH_STORE" (
        "BatchId" varchar(80) not null,
        "DestinationNodeId" text not null,
        "DestinationCode" varchar(30),
        "DestinationName" varchar(120),
        "ApiUrl" varchar(240),
        "Status" varchar(30) not null default 'PENDING_SEND',
        "Attempts" integer not null default 0,
        "LastError" text,
        "SentAt" timestamptz,
        "ReceivedAt" timestamptz,
        "AppliedAt" timestamptz,
        "AppliedCount" integer not null default 0,
        "NotFoundCount" integer not null default 0,
        "DuplicateSourceCount" integer not null default 0,
        "DuplicateTargetCount" integer not null default 0,
        "InvalidCount" integer not null default 0,
        "ErrorCount" integer not null default 0,
        "CreatedAt" timestamptz not null default now(),
        "UpdatedAt" timestamptz not null default now(),
        primary key ("BatchId", "DestinationNodeId")
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_PRICE_CHANGE_BATCH_STORE_Status"
      on dbo."PRICE_CHANGE_BATCH_STORE" ("Status", "UpdatedAt")
    `);

    // Marca cuando el rol LOCAL SERVICE reporto con exito este batch al VPS/REMOTO propio.
    // Sin esto, reportPendingPriceChangeResults() no tiene forma de distinguir "ya reportado"
    // de "terminal pero sin reportar": con mas de `limit` batches terminales a la vez, la
    // consulta ordenada por UpdatedAt siempre devuelve los mismos `limit` mas viejos (su
    // UpdatedAt no cambia al reportar), y los batches mas nuevos nunca llegan a reportarse.
    await this.prisma.$executeRawUnsafe(`
      alter table dbo."PRICE_CHANGE_BATCH_STORE"
      add column if not exists "ReportedAt" timestamptz
    `);

    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_PRICE_CHANGE_BATCH_STORE_ReportedAt"
      on dbo."PRICE_CHANGE_BATCH_STORE" ("ReportedAt")
    `);

    // Resultado por articulo por tienda. Escrita por el rol LOCAL SERVICE al aplicar; sin
    // precedente en transfers/dev-returns/mirror-sync (ninguno persiste resultado por item).
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."PRICE_CHANGE_BATCH_ITEM_RESULT" (
        "BatchId" varchar(80) not null,
        "DestinationNodeId" text not null,
        "CodigoBarra" varchar(30) not null,
        "Status" varchar(30) not null default 'PENDING',
        "AppliedCostoInicial" numeric,
        "AppliedCostoPromedio" numeric,
        "AppliedUltimoCosto" numeric,
        "AppliedCostoDolar" numeric,
        "ErrorMessage" text,
        "AppliedAt" timestamptz,
        primary key ("BatchId", "DestinationNodeId", "CodigoBarra")
      )
    `);

    // Outbox ORIGEN -> rol VPS/REMOTO de cada destino. Misma forma que TRANSFER_SYNC_OUTBOX.
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."PRICE_CHANGE_SYNC_OUTBOX" (
        "GlobalId" text primary key,
        "BatchId" varchar(80) not null,
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

    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_PRICE_CHANGE_SYNC_OUTBOX_Status"
      on dbo."PRICE_CHANGE_SYNC_OUTBOX" ("Status", "CreatedAt")
    `);

    // Inbox del rol VPS/REMOTO (recibe del origen: EventType='PRICE_CHANGE_BATCH', Status
    // arranca en RECEIVED y solo el rol LOCAL SERVICE la avanza a APPLYING/APPLIED/ERROR).
    // Misma forma que TRANSFER_SYNC_INBOX.
    await this.prisma.$executeRawUnsafe(`
      create table if not exists dbo."PRICE_CHANGE_SYNC_INBOX" (
        "GlobalId" text primary key,
        "BatchId" varchar(80) not null,
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

    await this.prisma.$executeRawUnsafe(`
      create index if not exists "IX_PRICE_CHANGE_SYNC_INBOX_Status"
      on dbo."PRICE_CHANGE_SYNC_INBOX" ("Status", "ReceivedAt")
    `);

    this.logger.log("Esquema de Cambio de Precio verificado (SYNC_NODES + 6 tablas PRICE_CHANGE_*).");
  }
}

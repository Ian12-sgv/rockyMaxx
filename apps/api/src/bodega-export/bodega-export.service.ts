import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../prisma/prisma.service";
import { buildPayload } from "./payload.util";
import { serializePkOrigen } from "./pk-origen.util";

const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_STARTUP_DELAY_MS = 5000;
const BATCH_LIMIT = 1000;

type Operacion = "SNAPSHOT" | "INSERT" | "UPDATE" | "DELETE";

type RegistroPayload = {
  pkOrigen: string;
  operacion: Operacion;
  payload: Record<string, unknown>;
  fechaExtraida: string;
};

type TablaBatch = {
  entidadDestino: string;
  tablaOrigen: string;
  registros: RegistroPayload[];
};

// Extractor por tienda: lee las tablas legacy locales, arma pk_origen +
// payload_json y hace POST hacia bodega-api cada BODEGA_SYNC_INTERVAL_MS.
// NO calcula hash_registro (lo hace el servidor). Sigue el mismo patron de
// timers que MirrorSyncService (setTimeout arranque + setInterval ciclo).
@Injectable()
export class BodegaExportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BodegaExportService.name);
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private cycleInProgress = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.isEnabled()) {
      this.logger.log("Extraccion hacia bodega de datos deshabilitada (BODEGA_SYNC_ENABLED != true).");
      return;
    }

    await this.ensureCursorSchema();

    const intervalMs = this.readIntegerConfig("BODEGA_SYNC_INTERVAL_MS", DEFAULT_INTERVAL_MS);

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runCycle("startup");
    }, DEFAULT_STARTUP_DELAY_MS);

    this.retryTimer = setInterval(() => {
      void this.runCycle("interval");
    }, intervalMs);

    this.logger.log(`Extraccion hacia bodega de datos activa cada ${intervalMs} ms.`);
  }

  onModuleDestroy() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private isEnabled() {
    return (
      String(this.configService.get<string>("BODEGA_SYNC_ENABLED", "") || "")
        .trim()
        .toLowerCase() === "true"
    );
  }

  private getIngestUrl() {
    return String(this.configService.get<string>("BODEGA_INGEST_URL", "") || "").trim();
  }

  private getIngestToken() {
    return String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();
  }

  private getWindowDays() {
    return this.readIntegerConfig("BODEGA_SYNC_WINDOW_DAYS", DEFAULT_WINDOW_DAYS);
  }

  private readIntegerConfig(key: string, fallback: number) {
    const raw = Number(this.configService.get<string | number>(key, fallback));
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.trunc(raw);
  }

  private async runCycle(reason: "startup" | "interval") {
    if (this.cycleInProgress || !this.isEnabled()) {
      return;
    }

    const ingestUrl = this.getIngestUrl();
    if (!ingestUrl) {
      this.logger.warn("BODEGA_SYNC_ENABLED=true pero BODEGA_INGEST_URL no esta configurado.");
      return;
    }

    this.cycleInProgress = true;

    try {
      const tablas: TablaBatch[] = [];
      const onSuccessCallbacks: Array<() => Promise<void>> = [];

      const inventario = await this.buildInventarioBatches();
      if (inventario) {
        tablas.push(...inventario.batches);
        onSuccessCallbacks.push(inventario.onSuccess);
      }

      const clientes = await this.buildClientesBatchIfDue();
      if (clientes) {
        tablas.push(clientes.batch);
        onSuccessCallbacks.push(clientes.onSuccess);
      }

      const windowDays = this.getWindowDays();

      const ventas = await this.buildVentasBatch(windowDays);
      if (ventas) {
        tablas.push(ventas.batch);
        onSuccessCallbacks.push(ventas.onSuccess);
      }

      const detalle = await this.buildVentasDetalleBatch(windowDays);
      if (detalle) {
        tablas.push(detalle.batch);
        onSuccessCallbacks.push(detalle.onSuccess);
      }

      const pagos = await this.buildPagosBatch(windowDays);
      if (pagos) {
        tablas.push(pagos.batch);
        onSuccessCallbacks.push(pagos.onSuccess);
      }

      const cajas = await this.buildCajasBatch(windowDays);
      if (cajas) {
        tablas.push(cajas.batch);
        onSuccessCallbacks.push(cajas.onSuccess);
      }

      if (tablas.length === 0) {
        return;
      }

      const result = await this.postIngest(ingestUrl, { tablas });

      for (const onSuccess of onSuccessCallbacks) {
        await onSuccess();
      }

      this.logger.log(
        `Ciclo bodega-export OK (${reason}): syncRunId=${(result as { syncRunId?: string })?.syncRunId ?? "?"} tablas=${tablas.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ciclo de extraccion hacia bodega fallo (${reason}): ${message}`);
    } finally {
      this.cycleInProgress = false;
    }
  }

  // ---------------------------------------------------------------------
  // Cursor local (solo optimiza lectura; la idempotencia real vive en
  // bodega-api via hash_registro). Tabla auxiliar creada por raw SQL, igual
  // que MIRROR_SYNC_OUTBOX/INBOX -- no se toca apps/api/prisma/schema.prisma.
  // ---------------------------------------------------------------------

  private async ensureCursorSchema() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS dbo."BODEGA_EXPORT_CURSOR" (
        "ClaveCursor" varchar(60) PRIMARY KEY,
        "ValorCursor" varchar(200),
        "ActualizadoEn" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private async getCursor(clave: string): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ ValorCursor: string | null }>>(
      `SELECT "ValorCursor" FROM dbo."BODEGA_EXPORT_CURSOR" WHERE "ClaveCursor" = $1`,
      clave,
    );
    return rows[0]?.ValorCursor ?? null;
  }

  private async setCursor(clave: string, valor: string) {
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO dbo."BODEGA_EXPORT_CURSOR" ("ClaveCursor", "ValorCursor", "ActualizadoEn")
        VALUES ($1, $2, now())
        ON CONFLICT ("ClaveCursor") DO UPDATE SET "ValorCursor" = excluded."ValorCursor", "ActualizadoEn" = now()
      `,
      clave,
      valor,
    );
  }

  // ---------------------------------------------------------------------
  // Constructores de lote por entidad
  // ---------------------------------------------------------------------

  // INVENTARIO alimenta DIM_ARTICULOS_HIST y HECH_INVENTARIO_HIST a la vez
  // (mismo pk_origen, mismo payload; bodega-api aplica su propia whitelist
  // por entidadDestino al calcular hash_registro).
  private async buildInventarioBatches(): Promise<{
    batches: TablaBatch[];
    onSuccess: () => Promise<void>;
  } | null> {
    const cursorKey = "INVENTARIO";
    const cursorRaw = await this.getCursor(cursorKey);
    const cursorDate = cursorRaw ? new Date(cursorRaw) : null;
    const isFirstRun = !cursorDate;

    const rows = await this.prisma.inventario.findMany({
      where: cursorDate
        ? {
            OR: [{ UltimaActualizacion: { gt: cursorDate } }, { UltimaActualizacion: null }],
          }
        : undefined,
      orderBy: { UltimaActualizacion: "asc" },
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    const operacion: Operacion = isFirstRun ? "SNAPSHOT" : "UPDATE";
    let maxSeen: Date | null = null;

    const registros = rows.map((row) => {
      if (row.UltimaActualizacion && (!maxSeen || row.UltimaActualizacion > maxSeen)) {
        maxSeen = row.UltimaActualizacion;
      }
      return {
        pkOrigen: serializePkOrigen([row.CodigoBarra]),
        operacion,
        payload: buildPayload(row as unknown as Record<string, unknown>, ["CodigoBarra"]),
        fechaExtraida: now.toISOString(),
      };
    });

    const batches: TablaBatch[] = [
      { entidadDestino: "DIM_ARTICULOS_HIST", tablaOrigen: "INVENTARIO", registros },
      { entidadDestino: "HECH_INVENTARIO_HIST", tablaOrigen: "INVENTARIO", registros },
    ];

    return {
      batches,
      onSuccess: async () => {
        if (maxSeen) {
          await this.setCursor(cursorKey, (maxSeen as Date).toISOString());
        }
      },
    };
  }

  // CLIENTES: snapshot completo, gateado a una vez por dia (no cada minuto).
  private async buildClientesBatchIfDue(): Promise<{ batch: TablaBatch; onSuccess: () => Promise<void> } | null> {
    const cursorKey = "CLIENTES_SNAPSHOT_DATE";
    const today = new Date().toISOString().slice(0, 10);
    const lastRunDate = await this.getCursor(cursorKey);

    if (lastRunDate === today) {
      return null;
    }

    const rows = await this.prisma.clientes.findMany({ take: 50000 });
    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    const registros = rows.map((row) => ({
      pkOrigen: serializePkOrigen([row.Codigo]),
      operacion: "SNAPSHOT" as const,
      payload: buildPayload(row as unknown as Record<string, unknown>, ["Codigo"]),
      fechaExtraida: now.toISOString(),
    }));

    return {
      batch: { entidadDestino: "DIM_CLIENTES_HIST", tablaOrigen: "CLIENTES", registros },
      onSuccess: async () => {
        await this.setCursor(cursorKey, today);
      },
    };
  }

  private computeWindowStart(windowDays: number): Date {
    return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  }

  // VENTAS, MOVVENTAS, PAGOSVENTA, DIARIOCAJA no tienen columna de
  // actualizacion confiable (ver handoff), asi que se usa la propia columna
  // de fecha del documento como cursor incremental (igual que INVENTARIO):
  // arranca en windowStart la primera vez, y de ahi en adelante solo avanza
  // hacia adelante. Sin esto, un lote con mas de BATCH_LIMIT filas en la
  // ventana quedaba truncado para siempre (las filas mas nuevas dentro de la
  // ventana nunca se alcanzaban a enviar).
  private async buildVentasBatch(
    windowDays: number,
  ): Promise<{ batch: TablaBatch; onSuccess: () => Promise<void> } | null> {
    const cursorKey = "VENTAS";
    const cursorRaw = await this.getCursor(cursorKey);
    const cursorDate = cursorRaw ? new Date(cursorRaw) : this.computeWindowStart(windowDays);

    const rows = await this.prisma.ventas.findMany({
      where: { Fecha: { gt: cursorDate } },
      orderBy: { Fecha: "asc" },
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    let maxSeen = cursorDate;

    const registros = rows.map((row) => {
      if (row.Fecha > maxSeen) maxSeen = row.Fecha;
      return {
        pkOrigen: serializePkOrigen([row.NumeroFactura, row.Serie]),
        operacion: "SNAPSHOT" as const,
        payload: buildPayload(row as unknown as Record<string, unknown>, ["NumeroFactura", "Serie"]),
        fechaExtraida: now.toISOString(),
      };
    });

    return {
      batch: { entidadDestino: "HECH_VENTAS_HIST", tablaOrigen: "VENTAS", registros },
      onSuccess: async () => {
        await this.setCursor(cursorKey, maxSeen.toISOString());
      },
    };
  }

  private async buildVentasDetalleBatch(
    windowDays: number,
  ): Promise<{ batch: TablaBatch; onSuccess: () => Promise<void> } | null> {
    const cursorKey = "MOVVENTAS";
    const cursorRaw = await this.getCursor(cursorKey);
    const cursorDate = cursorRaw ? new Date(cursorRaw) : this.computeWindowStart(windowDays);

    const rows = await this.prisma.movVentas.findMany({
      where: { Hora: { gt: cursorDate } },
      orderBy: { Hora: "asc" },
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    let maxSeen = cursorDate;

    const registros = rows.map((row) => {
      if (row.Hora > maxSeen) maxSeen = row.Hora;
      return {
        pkOrigen: serializePkOrigen([row.NumeroFactura, row.Serie, row.Item]),
        operacion: "SNAPSHOT" as const,
        payload: buildPayload(row as unknown as Record<string, unknown>, ["NumeroFactura", "Serie", "Item"]),
        fechaExtraida: now.toISOString(),
      };
    });

    return {
      batch: { entidadDestino: "HECH_VENTAS_DETALLE_HIST", tablaOrigen: "MOVVENTAS", registros },
      onSuccess: async () => {
        await this.setCursor(cursorKey, maxSeen.toISOString());
      },
    };
  }

  private async buildPagosBatch(
    windowDays: number,
  ): Promise<{ batch: TablaBatch; onSuccess: () => Promise<void> } | null> {
    const cursorKey = "PAGOSVENTA";
    const cursorRaw = await this.getCursor(cursorKey);
    const cursorDate = cursorRaw ? new Date(cursorRaw) : this.computeWindowStart(windowDays);

    const rows = await this.prisma.pagosVenta.findMany({
      where: { Fecha: { gt: cursorDate } },
      orderBy: { Fecha: "asc" },
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    let maxSeen = cursorDate;

    const registros = rows.map((row) => {
      if (row.Fecha > maxSeen) maxSeen = row.Fecha;
      return {
        pkOrigen: serializePkOrigen([row.NumeroFactura, row.Serie, row.Item]),
        operacion: "SNAPSHOT" as const,
        payload: buildPayload(row as unknown as Record<string, unknown>, ["NumeroFactura", "Serie", "Item"]),
        fechaExtraida: now.toISOString(),
      };
    });

    return {
      batch: { entidadDestino: "HECH_PAGOS_HIST", tablaOrigen: "PAGOSVENTA", registros },
      onSuccess: async () => {
        await this.setCursor(cursorKey, maxSeen.toISOString());
      },
    };
  }

  private async buildCajasBatch(
    windowDays: number,
  ): Promise<{ batch: TablaBatch; onSuccess: () => Promise<void> } | null> {
    const cursorKey = "DIARIOCAJA";
    const cursorRaw = await this.getCursor(cursorKey);
    const cursorDate = cursorRaw ? new Date(cursorRaw) : this.computeWindowStart(windowDays);

    const rows = await this.prisma.diarioCaja.findMany({
      where: { Fecha: { gt: cursorDate } },
      orderBy: { Fecha: "asc" },
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    let maxSeen = cursorDate;

    const registros = rows.map((row) => {
      if (row.Fecha > maxSeen) maxSeen = row.Fecha;
      return {
        pkOrigen: serializePkOrigen([row.Serie, row.Fecha]),
        operacion: "SNAPSHOT" as const,
        payload: buildPayload(row as unknown as Record<string, unknown>, ["Serie", "Fecha"]),
        fechaExtraida: now.toISOString(),
      };
    });

    return {
      batch: { entidadDestino: "HECH_CAJAS_HIST", tablaOrigen: "DIARIOCAJA", registros },
      onSuccess: async () => {
        await this.setCursor(cursorKey, maxSeen.toISOString());
      },
    };
  }

  private async postIngest(url: string, body: { tablas: TablaBatch[] }) {
    const token = this.getIngestToken();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`bodega-api respondio ${response.status}: ${text || "sin detalle"}`);
    }

    return response.json().catch(() => null);
  }
}

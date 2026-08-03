import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

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

// Un envio agrupa las tablas que comparten cursor/onSuccess (hoy solo
// INVENTARIO, que alimenta dos entidades desde la misma lectura). Cada envio
// viaja en su propio POST para que la falla de uno (ej. CLIENTES por
// ArrayMaxSize) no le impida avanzar el cursor a los demas.
type Envio = { tablas: TablaBatch[]; onSuccess: () => Promise<void> };

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
      const envios = await this.buildEnvios();
      if (envios.length === 0) {
        return;
      }

      let okCount = 0;
      let failCount = 0;

      for (const envio of envios) {
        const entidades = envio.tablas.map((t) => t.entidadDestino).join("+");
        try {
          const result = await this.postIngest(ingestUrl, { tablas: envio.tablas });
          await envio.onSuccess();
          okCount += 1;
          this.logger.log(
            `Ciclo bodega-export OK (${reason}): entidades=${entidades} syncRunId=${(result as { syncRunId?: string })?.syncRunId ?? "?"} filas=${envio.tablas.reduce((n, t) => n + t.registros.length, 0)}`,
          );
        } catch (error) {
          failCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Ciclo de extraccion hacia bodega fallo (${reason}) entidades=${entidades}: ${message}`);
        }
      }

      if (failCount > 0) {
        this.logger.warn(`Ciclo bodega-export con fallas (${reason}): ok=${okCount} fallidos=${failCount}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ciclo de extraccion hacia bodega fallo (${reason}) al leer datos locales: ${message}`);
    } finally {
      this.cycleInProgress = false;
    }
  }

  private async buildEnvios(): Promise<Envio[]> {
    const envios: Envio[] = [];

    const inventario = await this.buildInventarioBatches();
    if (inventario) {
      envios.push({ tablas: inventario.batches, onSuccess: inventario.onSuccess });
    }

    const clientes = await this.buildClientesBatchIfDue();
    if (clientes) {
      envios.push({ tablas: [clientes.batch], onSuccess: clientes.onSuccess });
    }

    const windowDays = this.getWindowDays();

    const ventas = await this.buildVentasBatch(windowDays);
    if (ventas) envios.push({ tablas: [ventas.batch], onSuccess: ventas.onSuccess });

    const detalle = await this.buildVentasDetalleBatch(windowDays);
    if (detalle) envios.push({ tablas: [detalle.batch], onSuccess: detalle.onSuccess });

    const pagos = await this.buildPagosBatch(windowDays);
    if (pagos) envios.push({ tablas: [pagos.batch], onSuccess: pagos.onSuccess });

    const cajas = await this.buildCajasBatch(windowDays);
    if (cajas) envios.push({ tablas: [cajas.batch], onSuccess: cajas.onSuccess });

    return envios;
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
  //
  // Cursor compuesto (UltimaActualizacion, CodigoBarra) en vez de solo fecha:
  // cuando muchas filas comparten el mismo UltimaActualizacion (tipico de una
  // carga masiva/migracion -- confirmado en tienda001, 6688 de 6703 filas con
  // el mismo timestamp), un cursor de solo fecha con "gt" avanza tras la
  // primera tanda y deja el resto de ese grupo inalcanzable para siempre.
  // CodigoBarra (PK, unico) desempata dentro del mismo timestamp. Ordenar
  // ASC en Postgres deja los NULL de UltimaActualizacion al final, asi que
  // el barrido los alcanza una sola vez al terminar el resto.
  private async buildInventarioBatches(): Promise<{
    batches: TablaBatch[];
    onSuccess: () => Promise<void>;
  } | null> {
    const cursorKey = "INVENTARIO";
    const cursorRaw = await this.getCursor(cursorKey);
    const cursor = cursorRaw ? this.parseInventarioCursor(cursorRaw) : null;
    const isFirstRun = !cursor;

    let where: Prisma.InventarioWhereInput | undefined;
    if (cursor) {
      where =
        cursor.fecha !== null
          ? {
              OR: [
                { UltimaActualizacion: { gt: new Date(cursor.fecha) } },
                { UltimaActualizacion: new Date(cursor.fecha), CodigoBarra: { gt: cursor.pk } },
                { UltimaActualizacion: null },
              ],
            }
          : { UltimaActualizacion: null, CodigoBarra: { gt: cursor.pk } };
    }

    const rows = await this.prisma.inventario.findMany({
      where,
      orderBy: [{ UltimaActualizacion: "asc" }, { CodigoBarra: "asc" }],
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      return null;
    }

    const now = new Date();
    const operacion: Operacion = isFirstRun ? "SNAPSHOT" : "UPDATE";

    const registros = rows.map((row) => ({
      pkOrigen: serializePkOrigen([row.CodigoBarra]),
      operacion,
      payload: buildPayload(row as unknown as Record<string, unknown>, ["CodigoBarra"]),
      fechaExtraida: now.toISOString(),
    }));

    const lastRow = rows[rows.length - 1];
    const nextCursor = {
      fecha: lastRow.UltimaActualizacion ? lastRow.UltimaActualizacion.toISOString() : null,
      pk: lastRow.CodigoBarra,
    };

    const batches: TablaBatch[] = [
      { entidadDestino: "DIM_ARTICULOS_HIST", tablaOrigen: "INVENTARIO", registros },
      { entidadDestino: "HECH_INVENTARIO_HIST", tablaOrigen: "INVENTARIO", registros },
    ];

    return {
      batches,
      onSuccess: async () => {
        await this.setCursor(cursorKey, JSON.stringify(nextCursor));
      },
    };
  }

  // Compatibilidad con el cursor viejo de INVENTARIO (antes de hoy era solo
  // una fecha ISO en texto plano, no JSON). Si el valor guardado no parsea
  // como el nuevo formato compuesto, se reinterpreta como { fecha: raw, pk:
  // "" } -- eso reenvia una vez mas el grupo empatado en esa fecha (lo cual
  // es idempotente via hash_registro en bodega-api) y de ahi en adelante ya
  // avanza con el cursor compuesto normalmente.
  private parseInventarioCursor(raw: string): { fecha: string | null; pk: string } {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "pk" in parsed) {
        return parsed as { fecha: string | null; pk: string };
      }
    } catch {
      // No era JSON: cursor en formato viejo (solo fecha), cae al fallback de abajo.
    }
    return { fecha: raw, pk: "" };
  }

  // CLIENTES: snapshot completo una vez por dia, pero paginado por
  // BATCH_LIMIT a traves de varios ciclos (igual que las demas tablas) en
  // vez de mandar todo el catalogo en un solo POST -- con mas de 1000
  // clientes eso violaba el ArrayMaxSize(1000) del DTO en bodega-api y
  // fallaba con 400 en cada ciclo, sin arreglo automatico.
  private async buildClientesBatchIfDue(): Promise<{ batch: TablaBatch; onSuccess: () => Promise<void> } | null> {
    const dateCursorKey = "CLIENTES_SNAPSHOT_DATE";
    const offsetCursorKey = "CLIENTES_SNAPSHOT_OFFSET";
    const today = new Date().toISOString().slice(0, 10);
    const lastRunDate = await this.getCursor(dateCursorKey);

    if (lastRunDate === today) {
      return null;
    }

    const offsetRaw = await this.getCursor(offsetCursorKey);
    const offset = offsetRaw ? Number(offsetRaw) : 0;

    const rows = await this.prisma.clientes.findMany({
      orderBy: { Codigo: "asc" },
      skip: offset,
      take: BATCH_LIMIT,
    });

    if (rows.length === 0) {
      // Se recorrio todo el catalogo hoy: marca el dia como completo y
      // reinicia el offset para la proxima corrida diaria.
      await this.setCursor(dateCursorKey, today);
      await this.setCursor(offsetCursorKey, "0");
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
        await this.setCursor(offsetCursorKey, String(offset + rows.length));
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

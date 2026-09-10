import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { fetchWithTimeout } from "../shared/fetch-with-timeout.util";
import { syncHealthRegistry } from "../shared/sync-health.registry";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 15000;
const DIAGNOSTICO_REQUEST_TIMEOUT_MS = 20000;

// URL publica del bodega-api en el VPS -- NO es un secreto, ver el mismo
// comentario en bodega-export.service.ts.
const DEFAULT_BODEGA_API_BASE_URL = "http://68.183.105.135/bodega-api";

// Mismo criterio que bodega-export.service.ts para derivar el codigo de
// tienda del nombre de la base de datos local.
function resolveCodigoTiendaDesdeDatabaseUrl(databaseUrl: string): string | null {
  const nombre = String(databaseUrl || "");
  if (/_vps\b/i.test(nombre)) {
    return null;
  }
  const match = nombre.match(/rocky_tienda_0*(\d+)/i);
  if (!match) {
    return null;
  }
  return match[1].padStart(3, "0");
}

// Empuja periodicamente hacia bodega-api el estado de los subsistemas de
// sincronizacion de esta instancia (ver sync-health.registry.ts), para
// poder diagnosticar una tienda desde afuera sin pedirle que copie a mano
// el log local. Caso real que motivo esto: tienda 003 con el envio de
// VENTAS trabado en silencio durante horas mientras CAJAS seguia
// sincronizando bien -- con este reporte eso se ve directo en bodega_datos.
@Injectable()
export class DiagnosticoPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiagnosticoPushService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private pushInProgress = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (!this.isEnabled()) {
      return;
    }

    const intervalMs = this.readIntegerConfig("DIAGNOSTICO_PUSH_INTERVAL_MS", DEFAULT_INTERVAL_MS);

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.pushDiagnostico();
    }, DEFAULT_STARTUP_DELAY_MS);

    this.timer = setInterval(() => {
      void this.pushDiagnostico();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Se activa junto con bodega-export (mismo flag/deteccion automatica) --
  // no tiene sentido reportar diagnostico de sync a un servidor que esta
  // apagado para esta instancia.
  private isEnabled() {
    const explicit = String(this.configService.get<string>("BODEGA_SYNC_ENABLED", "") || "")
      .trim()
      .toLowerCase();
    if (explicit === "true" || explicit === "false") {
      return explicit === "true";
    }
    return this.resolveCodigoTienda() !== null;
  }

  private resolveCodigoTienda(): string | null {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    return resolveCodigoTiendaDesdeDatabaseUrl(databaseUrl);
  }

  private getBaseUrl(): string {
    const explicitBase = String(this.configService.get<string>("BODEGA_API_BASE_URL", "") || "").trim();
    if (explicitBase) {
      return explicitBase.replace(/\/+$/, "");
    }
    const ingestUrl = String(this.configService.get<string>("BODEGA_INGEST_URL", "") || "").trim();
    const marker = "/bodega/ingest/";
    const index = ingestUrl.indexOf(marker);
    if (index !== -1) {
      return ingestUrl.slice(0, index);
    }
    return DEFAULT_BODEGA_API_BASE_URL;
  }

  private getIngestToken() {
    return String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();
  }

  private readIntegerConfig(key: string, fallback: number) {
    const raw = Number(this.configService.get<string | number>(key, fallback));
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.trunc(raw);
  }

  private async pushDiagnostico() {
    if (this.pushInProgress) {
      return;
    }

    const codigoTienda = this.resolveCodigoTienda();
    const baseUrl = this.getBaseUrl();
    const token = this.getIngestToken();
    if (!codigoTienda || !token) {
      return;
    }

    this.pushInProgress = true;
    try {
      const payload = {
        generadoEn: new Date().toISOString(),
        subsistemas: syncHealthRegistry.snapshot(),
      };

      const response = await fetchWithTimeout(
        `${baseUrl}/bodega/diagnostico/${codigoTienda}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        DIAGNOSTICO_REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.logger.warn(`No se pudo enviar el diagnostico a bodega-api: ${response.status} ${text || "sin detalle"}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo enviar el diagnostico a bodega-api: ${message}`);
    } finally {
      this.pushInProgress = false;
    }
  }
}

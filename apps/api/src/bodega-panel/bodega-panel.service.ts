import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const INGEST_URL_MARKER = "/bodega/ingest/";

export type BodegaPanelResumen = {
  disponible: boolean;
  motivo?: string;
  ventas?: unknown;
  ventasAnterior?: unknown;
  inventario?: unknown;
  serieDiaria?: unknown;
  tasaCambio?: unknown;
};

// Proxy autenticado hacia bodega-api: reutiliza BODEGA_INGEST_URL/
// INGEST_AUTH_TOKEN (ya configurados en esta instancia para bodega-export)
// en vez de pedir variables de entorno nuevas. El token nunca llega al
// navegador -- esta llamada corre en el backend, el frontend solo ve el
// resultado ya resuelto.
@Injectable()
export class BodegaPanelService {
  private readonly logger = new Logger(BodegaPanelService.name);

  constructor(private readonly configService: ConfigService) {}

  async obtenerResumen(desde?: string, hasta?: string): Promise<BodegaPanelResumen> {
    const baseUrl = this.resolveBodegaApiBaseUrl();
    if (!baseUrl) {
      return {
        disponible: false,
        motivo: "Esta instancia no tiene configurada la conexion a bodega de datos (BODEGA_API_BASE_URL/BODEGA_INGEST_URL).",
      };
    }

    const token = String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();
    if (!token) {
      return {
        disponible: false,
        motivo: "INGEST_AUTH_TOKEN no esta configurado en esta instancia.",
      };
    }

    try {
      const params = new URLSearchParams();
      if (desde) {
        params.set("desde", desde);
      }
      if (hasta) {
        params.set("hasta", hasta);
      }
      const query = params.toString();
      const response = await fetch(`${baseUrl}/bodega/validaciones/panel-resumen${query ? `?${query}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return {
          disponible: false,
          motivo: `bodega-api respondio ${response.status}: ${text || "sin detalle"}`,
        };
      }

      const data = (await response.json()) as Omit<BodegaPanelResumen, "disponible" | "motivo">;
      return { disponible: true, ...data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo contactar bodega-api para el panel: ${message}`);
      return { disponible: false, motivo: `No se pudo contactar bodega-api: ${message}` };
    }
  }

  private resolveBodegaApiBaseUrl(): string | null {
    // BODEGA_API_BASE_URL es explicito (lo escribe el selector de "Servicio
    // Local" cuando el usuario activa "Conectar a bodega de datos en la
    // nube", sin necesidad de que este perfil tenga configurado el pipeline
    // de export). Si no esta, se deriva de BODEGA_INGEST_URL como antes
    // (perfiles como tienda001 que ya exportan a bodega-api).
    const explicitBaseUrl = String(this.configService.get<string>("BODEGA_API_BASE_URL", "") || "").trim();
    if (explicitBaseUrl) {
      return explicitBaseUrl.replace(/\/+$/, "");
    }

    const ingestUrl = String(this.configService.get<string>("BODEGA_INGEST_URL", "") || "").trim();
    if (!ingestUrl) {
      return null;
    }

    const index = ingestUrl.indexOf(INGEST_URL_MARKER);
    if (index === -1) {
      return null;
    }

    return ingestUrl.slice(0, index);
  }
}

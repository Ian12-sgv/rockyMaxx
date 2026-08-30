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

export type BodegaPanelMovimientosResultado = {
  disponible: boolean;
  motivo?: string;
  movimientos?: unknown;
};

export type CrearMovimientoInput = {
  tipo: "ingreso" | "egreso";
  esOperativo: boolean;
  monto: number;
  descripcion: string;
  fecha: string;
  codigosTienda: string[];
  registradoPor?: string;
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

  async listarMovimientos(desde?: string, hasta?: string, codigoTienda?: string): Promise<BodegaPanelMovimientosResultado> {
    const conexion = this.resolveConexion();
    if (!conexion.ok) {
      return { disponible: false, motivo: conexion.motivo };
    }

    try {
      const params = new URLSearchParams();
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      if (codigoTienda) params.set("codigoTienda", codigoTienda);
      const query = params.toString();
      const response = await fetch(`${conexion.baseUrl}/bodega/balance-movimientos${query ? `?${query}` : ""}`, {
        headers: { Authorization: `Bearer ${conexion.token}` },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { disponible: false, motivo: `bodega-api respondio ${response.status}: ${text || "sin detalle"}` };
      }
      const movimientos = await response.json();
      return { disponible: true, movimientos };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo listar movimientos de balance: ${message}`);
      return { disponible: false, motivo: `No se pudo contactar bodega-api: ${message}` };
    }
  }

  async crearMovimiento(input: CrearMovimientoInput): Promise<{ ok: boolean; motivo?: string; id?: string }> {
    const conexion = this.resolveConexion();
    if (!conexion.ok) {
      return { ok: false, motivo: conexion.motivo };
    }

    try {
      const response = await fetch(`${conexion.baseUrl}/bodega/balance-movimientos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conexion.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, motivo: `bodega-api respondio ${response.status}: ${text || "sin detalle"}` };
      }
      const data = (await response.json()) as { id: string };
      return { ok: true, id: data.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo crear movimiento de balance: ${message}`);
      return { ok: false, motivo: `No se pudo contactar bodega-api: ${message}` };
    }
  }

  async eliminarMovimiento(id: string): Promise<{ ok: boolean; motivo?: string }> {
    const conexion = this.resolveConexion();
    if (!conexion.ok) {
      return { ok: false, motivo: conexion.motivo };
    }

    try {
      const response = await fetch(`${conexion.baseUrl}/bodega/balance-movimientos/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${conexion.token}` },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, motivo: `bodega-api respondio ${response.status}: ${text || "sin detalle"}` };
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo eliminar movimiento de balance: ${message}`);
      return { ok: false, motivo: `No se pudo contactar bodega-api: ${message}` };
    }
  }

  private resolveConexion(): { ok: true; baseUrl: string; token: string } | { ok: false; motivo: string } {
    const baseUrl = this.resolveBodegaApiBaseUrl();
    if (!baseUrl) {
      return {
        ok: false,
        motivo: "Esta instancia no tiene configurada la conexion a bodega de datos (BODEGA_API_BASE_URL/BODEGA_INGEST_URL).",
      };
    }
    const token = String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();
    if (!token) {
      return { ok: false, motivo: "INGEST_AUTH_TOKEN no esta configurado en esta instancia." };
    }
    return { ok: true, baseUrl, token };
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

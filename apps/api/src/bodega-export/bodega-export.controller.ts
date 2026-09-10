import { Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";

import { syncHealthRegistry } from "../shared/sync-health.registry";
import { BodegaExportService } from "./bodega-export.service";

interface RequestWithSocket {
  socket?: { remoteAddress?: string };
}

// Sin login: pensado para dispararse desde un script local (PowerShell) en
// la MISMA PC donde corre el Servicio Local, para casos como "arregle la
// red de la tienda y no quiero esperar hasta 1 minuto al proximo ciclo
// automatico". Restringido a loopback -- cualquier otra PC de la red de la
// tienda (terminales de venta) no puede llamarlo.
function esLlamadaLocal(req: RequestWithSocket): boolean {
  const remoteAddress = String(req.socket?.remoteAddress || "");
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

@Controller("bodega-export")
export class BodegaExportController {
  constructor(private readonly bodegaExportService: BodegaExportService) {}

  @Post("forzar")
  async forzar(@Req() req: RequestWithSocket) {
    if (!esLlamadaLocal(req)) {
      throw new ForbiddenException("Este endpoint solo se puede llamar desde la misma PC donde corre el servicio.");
    }
    return this.bodegaExportService.forzarCicloManual();
  }

  // Snapshot de sync-health.registry.ts -- lo consume el script local
  // (ej. desatascar-servicio-local.ps1) para saber, con el error exacto,
  // que subsistema/tabla dejo de subir al VPS sin tener que abrir el log a
  // mano.
  @Get("estado")
  async estado(@Req() req: RequestWithSocket) {
    if (!esLlamadaLocal(req)) {
      throw new ForbiddenException("Este endpoint solo se puede llamar desde la misma PC donde corre el servicio.");
    }
    return syncHealthRegistry.snapshot();
  }
}

import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";

import { Alcance, PanelAuthGuard } from "./panel-auth.guard";
import { AlcancePanel, PanelAuthService } from "./panel-auth.service";

interface LoginRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

@Controller("bodega/auth")
export class PanelAuthController {
  constructor(private readonly panelAuthService: PanelAuthService) {}

  @Post("login")
  login(@Body() body: { usuario?: string; password?: string }, @Req() request: LoginRequest) {
    // Detras de nginx la IP real llega en X-Real-IP / X-Forwarded-For; solo
    // se usa para el bloqueo por intentos fallidos, no para autorizar.
    const reenviada = request.headers["x-real-ip"] || request.headers["x-forwarded-for"];
    const origen = String(Array.isArray(reenviada) ? reenviada[0] : reenviada || request.ip || "")
      .split(",")[0]
      .trim();
    return this.panelAuthService.login(String(body?.usuario || ""), String(body?.password || ""), origen);
  }

  // Para que el frontend sepa, al recargar, con que usuario/grupo esta la
  // sesion guardada (y si sigue valida).
  @Get("me")
  @UseGuards(PanelAuthGuard)
  me(@Alcance() alcance: AlcancePanel) {
    return alcance;
  }
}

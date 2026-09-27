import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AlcancePanel, PanelAuthService } from "./panel-auth.service";

interface PanelRequest {
  headers: { authorization?: string };
  alcancePanel?: AlcancePanel;
}

// Acepta dos tipos de Bearer:
// - INGEST_AUTH_TOKEN: acceso total. Lo sigue usando apps/api (vista "Todas
//   las tiendas" de cada tienda, via bodega-panel.service.ts) y no se puede
//   cambiar sin reinstalar el servicio en las tiendas.
// - Sesion de usuario del panel (POST /bodega/auth/login): alcance segun su
//   grupo (ver PanelAuthService).
@Injectable()
export class PanelAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly panelAuthService: PanelAuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PanelRequest>();
    const header = String(request.headers.authorization || "");
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    if (!token) {
      throw new UnauthorizedException("Sesion ausente. Inicia sesion de nuevo.");
    }

    const ingestToken = String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();
    if (ingestToken && token === ingestToken) {
      request.alcancePanel = { usuario: "sistema", grupo: "TODOS" };
      return true;
    }

    const alcance = this.panelAuthService.verificarSesion(token);
    if (!alcance) {
      throw new UnauthorizedException("Sesion invalida o expirada. Inicia sesion de nuevo.");
    }
    request.alcancePanel = alcance;
    return true;
  }
}

export const Alcance = createParamDecorator((_data: unknown, context: ExecutionContext): AlcancePanel => {
  const alcance = context.switchToHttp().getRequest<PanelRequest>().alcancePanel;
  if (!alcance) {
    // Solo pasa si alguien usa @Alcance() en una ruta sin PanelAuthGuard.
    throw new UnauthorizedException("Ruta sin PanelAuthGuard.");
  }
  return alcance;
});

export function exigirAdmin(alcance: AlcancePanel) {
  if (alcance.grupo !== "TODOS") {
    throw new ForbiddenException("Tu usuario solo tiene permiso de lectura.");
  }
}

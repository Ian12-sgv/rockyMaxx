import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface AuthorizedRequest {
  headers: {
    authorization?: string;
  };
}

@Injectable()
export class IngestAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const expectedToken = String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();

    if (!expectedToken) {
      throw new UnauthorizedException("INGEST_AUTH_TOKEN no esta configurado en el servidor.");
    }

    const header = String(request.headers.authorization || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    const providedToken = match?.[1]?.trim() || "";

    if (!providedToken || providedToken !== expectedToken) {
      throw new UnauthorizedException("Token de ingest invalido o ausente.");
    }

    return true;
  }
}

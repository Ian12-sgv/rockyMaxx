import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { AuthService, AuthTokenPayload } from "../auth.service";
import { AuthenticatedRequest } from "../interfaces/authenticated-request.interface";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Token no suministrado");
    }

    const token = header.slice(7).trim();

    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token);
      request.user = await this.authService.getAuthenticatedUser(payload.sub);
      return true;
    } catch {
      throw new UnauthorizedException("Token inválido");
    }
  }
}
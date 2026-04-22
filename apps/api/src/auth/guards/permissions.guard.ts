import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";

import { PrismaService } from "../../prisma/prisma.service";
import { normalizePermissionCodeValue } from "../../shared/permission-codes.util";
import { isProtectedSystemRoleCode } from "../../shared/protected-admin.util";
import { normalizeLegacyGroupCode } from "../../users/user-groups.util";
import { REQUIRED_PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { AuthenticatedRequest } from "../interfaces/authenticated-request.interface";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("Usuario no autenticado");
    }

    const userGroups = user.grupos.map((group) => normalizeLegacyGroupCode(group.codigo));
    if (userGroups.some((group) => isProtectedSystemRoleCode(group, this.configService))) {
      return true;
    }

    const normalizedPermissions = Array.from(
      new Set(
        requiredPermissions
          .map((permission) => normalizePermissionCodeValue(permission))
          .filter((permission) => permission.length > 0),
      ),
    );

    if (normalizedPermissions.length === 0) {
      return true;
    }

    const grantedPermissions = await this.prisma.grupoSeg.count({
      where: {
        CodGrupo: {
          in: userGroups,
        },
        CodNodo: {
          in: normalizedPermissions,
        },
        OR: [{ Ver: "S" }, { Ver: null }],
      },
    });

    if (grantedPermissions === 0) {
      throw new ForbiddenException("Permisos insuficientes");
    }

    return true;
  }
}

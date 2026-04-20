import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { normalizeLegacyGroupCode } from "../../users/user-groups.util";
import { REQUIRED_GROUPS_KEY } from "../decorators/require-groups.decorator";
import { AuthenticatedRequest } from "../interfaces/authenticated-request.interface";

@Injectable()
export class GroupsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredGroups = this.reflector.getAllAndOverride<string[]>(REQUIRED_GROUPS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredGroups || requiredGroups.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("Usuario no autenticado");
    }

    const normalizedRequired = requiredGroups.map((group) => normalizeLegacyGroupCode(group));
    const userGroups = user.grupos.map((group) => normalizeLegacyGroupCode(group.codigo));
    const hasAccess = normalizedRequired.some((group) => userGroups.includes(group));

    if (!hasAccess) {
      throw new ForbiddenException("Permisos insuficientes");
    }

    return true;
  }
}
import { ConfigService } from "@nestjs/config";

import { normalizeLegacyGroupCode } from "../users/user-groups.util";

export function getProtectedAdminUsername(configService: ConfigService) {
  return (configService.get<string>("AUTH_BOOTSTRAP_ADMIN_USERNAME", "rocky") || "rocky").trim().toLowerCase();
}

export function getProtectedAdminRoleCode(configService: ConfigService) {
  return normalizeLegacyGroupCode(configService.get<string>("AUTH_BOOTSTRAP_ADMIN_GROUP", "admin") || "admin");
}

export function isProtectedAdminUserCode(codUsuario: string, configService: ConfigService) {
  return codUsuario.trim().toLowerCase() === getProtectedAdminUsername(configService);
}

export function isProtectedAdminRoleCode(codGrupo: string, configService: ConfigService) {
  return normalizeLegacyGroupCode(codGrupo) === getProtectedAdminRoleCode(configService);
}
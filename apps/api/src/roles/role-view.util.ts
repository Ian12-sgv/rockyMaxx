import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { isProtectedAdminRoleCode } from "../shared/protected-admin.util";

export const roleWithRelationsInclude = Prisma.validator<Prisma.GruposInclude>()({
  usuarioGrupo: {
    include: {
      usuario: true,
    },
  },
  grupoSeg: {
    include: {
      seg: true,
    },
  },
});

export type RoleWithRelations = Prisma.GruposGetPayload<{
  include: typeof roleWithRelationsInclude;
}>;

export function normalizePermissionCode(value: string) {
  return value.trim().toUpperCase();
}

export function toRoleView(role: RoleWithRelations, configService: ConfigService) {
  return {
    codigo: role.CodGrupo,
    nombre: role.NombreGrupo,
    protegidoAdmin: isProtectedAdminRoleCode(role.CodGrupo, configService),
    totalUsuarios: role.usuarioGrupo.length,
    totalPermisos: role.grupoSeg.length,
    usuarios: role.usuarioGrupo
      .map((item) => ({
        codUsuario: item.usuario.CodUsuario,
        nombreUsuario: item.usuario.NombreUsuario,
        status: item.usuario.Status,
      }))
      .sort((left, right) => left.codUsuario.localeCompare(right.codUsuario)),
    permisos: role.grupoSeg
      .map((item) => ({
        codigo: item.seg.CodNodo,
        nombre: item.seg.NomNodo,
        ver: item.Ver,
      }))
      .sort((left, right) => left.codigo.localeCompare(right.codigo)),
  };
}
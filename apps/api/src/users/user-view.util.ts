import { Prisma } from "@prisma/client";

export const userWithGroupsInclude = Prisma.validator<Prisma.UsuariosInclude>()({
  usuarioGrupos: {
    include: {
      grupo: {
        include: {
          grupoSeg: {
            include: {
              seg: true,
            },
          },
        },
      },
    },
  },
});

export type UserWithGroups = Prisma.UsuariosGetPayload<{
  include: typeof userWithGroupsInclude;
}>;

export type UserView = {
  codUsuario: string;
  nombreUsuario: string | null;
  status: number | null;
  grupos: Array<{
    codigo: string;
    nombre: string;
  }>;
  permisos: string[];
};

export function toUserView(user: UserWithGroups): UserView {
  const permissions = Array.from(
    new Set(
      user.usuarioGrupos.flatMap((item) =>
        item.grupo.grupoSeg
          .map((permission) => normalizePermissionCode(permission.seg.CodNodo))
          .filter(Boolean),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    codUsuario: user.CodUsuario,
    nombreUsuario: user.NombreUsuario,
    status: user.Status,
    grupos: user.usuarioGrupos
      .map((item) => ({
        codigo: item.grupo.CodGrupo,
        nombre: item.grupo.NombreGrupo,
      }))
      .sort((left, right) => left.codigo.localeCompare(right.codigo)),
    permisos: permissions,
  };
}

function normalizePermissionCode(value: string) {
  return value.trim().toUpperCase();
}

import { Prisma } from "@prisma/client";

export const userWithGroupsInclude = Prisma.validator<Prisma.UsuariosInclude>()({
  usuarioGrupos: {
    include: {
      grupo: true,
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
};

export function toUserView(user: UserWithGroups): UserView {
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
  };
}
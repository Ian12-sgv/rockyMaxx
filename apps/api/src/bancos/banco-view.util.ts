import { Bancos } from "@prisma/client";

export function toBancoView(item: Bancos) {
  return {
    codigo: item.Codigo,
    nombre: item.Nombre,
    status: item.Status ?? 1,
  };
}

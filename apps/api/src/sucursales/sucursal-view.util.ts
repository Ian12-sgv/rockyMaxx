import { type Sucursales } from "@prisma/client";

export function toSucursalView(item: Sucursales) {
  return {
    codigo: item.Codigo,
    nombre: item.Nombre,
    direccion: item.Direccion ?? "",
    telefono: item.Telefono ?? "",
    status: item.Status,
    statusNombre: item.Status === 1 ? "Abierta" : "Cerrada",
    porcentajeDeRedondeo: item.PorcentajeDeRedondeo?.toString() ?? "0",
  };
}

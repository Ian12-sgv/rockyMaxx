import { type Clientes, type TiposCliente, type TiposContribuyente } from "@prisma/client";

type ClienteWithRelations = Clientes & {
  tipoCliente?: TiposCliente | null;
  contribuyenteTipo?: TiposContribuyente | null;
};

export function toClienteView(item: ClienteWithRelations) {
  return {
    codigo: item.Codigo,
    nombre: item.Nombre,
    fechaIngreso: item.FechaIngreso,
    telefono: item.Telefono ?? "",
    direccion: item.Direccion ?? "",
    status: item.Status ?? 1,
    statusNombre: Number(item.Status ?? 1) === 1 ? "Activo" : "Inactivo",
    tipo: item.Tipo,
    tipoNombre: item.tipoCliente?.Descripcion ?? String(item.Tipo ?? ""),
    tipoContribuyente: item.TipoContribuyente,
    tipoContribuyenteNombre: item.contribuyenteTipo?.Descripcion ?? String(item.TipoContribuyente ?? ""),
  };
}

export function toTipoClienteView(item: TiposCliente) {
  return {
    codigo: item.Codigo,
    nombre: item.Descripcion ?? String(item.Codigo),
    status: item.Status ?? 1,
  };
}

export function toTipoContribuyenteView(item: TiposContribuyente) {
  return {
    codigo: item.Codigo,
    nombre: item.Descripcion ?? String(item.Codigo),
    status: item.Status ?? 1,
  };
}

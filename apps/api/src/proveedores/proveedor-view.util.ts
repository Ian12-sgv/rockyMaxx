import { type Proveedores, type TiposProveedor } from "@prisma/client";

type ProveedorWithRelations = Proveedores & {
  tipoProveedor?: TiposProveedor | null;
};

export function toProveedorView(item: ProveedorWithRelations) {
  return {
    codigo: item.Codigo,
    nombre: item.Nombre,
    tipo: item.Tipo,
    tipoNombre: item.tipoProveedor?.Descripcion ?? String(item.Tipo ?? ""),
    contacto: item.Contacto ?? "",
    fechaIngreso: item.FechaIngreso,
    pais: item.Pais ?? "",
    estado: item.Estado ?? "",
    ciudad: item.Ciudad ?? "",
    codigoPostal: item.CodigoPostal ?? "",
    direccion: item.Direccion ?? "",
    telefono: item.Telefono ?? "",
    fax: item.Fax ?? "",
    status: item.Status ?? 1,
    statusNombre: Number(item.Status ?? 1) === 1 ? "Activo" : "Inactivo",
  };
}

export function toTipoProveedorView(item: TiposProveedor) {
  return {
    codigo: item.Codigo,
    nombre: item.Descripcion ?? String(item.Codigo),
    status: item.Status ?? 1,
  };
}

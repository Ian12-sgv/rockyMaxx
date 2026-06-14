import { type Cargos, type Trabajadores } from "@prisma/client";

type TrabajadorWithCargo = Trabajadores & {
  cargoRef?: Cargos | null;
};

export function toTrabajadorView(item: TrabajadorWithCargo) {
  return {
    cedula: item.Cedula,
    codigo: item.Codigo,
    nombre: item.Nombre,
    cargo: item.Cargo,
    cargoNombre: item.cargoRef?.Nombre ?? item.Cargo,
    fechaIngreso: item.FechaIngreso,
    fechaNacimiento: item.FechaNacimiento,
    direccion: item.Direccion ?? "",
    telefono: item.Telefono ?? "",
    celular: item.Celular ?? "",
    status: item.Status ?? 1,
    statusNombre: Number(item.Status ?? 1) === 1 ? "Activo" : "Inactivo",
  };
}

export function toCargoView(item: Cargos) {
  return {
    codigo: item.Codigo,
    nombre: item.Nombre ?? item.Codigo,
    status: item.Status ?? 1,
  };
}

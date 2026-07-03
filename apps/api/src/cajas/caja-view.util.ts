import { type Cajas, type DiarioCaja } from "@prisma/client";

type DiarioCajaWithCaja = DiarioCaja & {
  caja?: Cajas | null;
};

function formatTime(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDateKey(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  return value.toISOString().slice(0, 10);
}

function resolveStatusName(status: number) {
  if (status === 2) {
    return "Caja cerrada";
  }

  if (status === 1) {
    return "Apertura con ventas";
  }

  return "Apertura hecha";
}

export function toCajaView(item: DiarioCajaWithCaja) {
  return {
    serie: item.Serie,
    fecha: formatDateKey(item.Fecha),
    numeroCaja: item.Numero,
    facturaInicial: item.FacturaInicial?.toString() ?? "0",
    ultimaFactura: item.FacturaFinal?.toString() ?? "0",
    horaApertura: formatTime(item.HoraApertura),
    horaCierre: formatTime(item.HoraCierre),
    status: item.Status,
    statusNombre: resolveStatusName(item.Status),
    puedeEliminar: item.Status === 0,
    nombreImpresora: item.caja?.NombreImpresora ?? "",
    ultimaFacturaCaja: item.caja?.UltimaFactura?.toString() ?? "0",
  };
}

export function toCajaConfigView(item: Cajas) {
  return {
    serie: item.Serie,
    numeroCaja: item.Numero,
    ultimaFactura: item.UltimaFactura?.toString() ?? "0",
    nombreImpresora: item.NombreImpresora ?? "",
  };
}

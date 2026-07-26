import { FormaPago } from "@prisma/client";

export function toTipoPagoView(item: FormaPago) {
  return {
    codigo: item.Codigo,
    nombre: item.Nombre ?? String(item.Codigo),
    status: item.Status ?? 1,
    orden: item.Orden ?? item.Codigo,
    esDolar: Boolean(item.EsDolar),
  };
}

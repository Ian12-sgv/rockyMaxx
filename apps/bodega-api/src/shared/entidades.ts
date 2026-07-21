export const ENTIDADES_DESTINO = [
  "DIM_ARTICULOS_HIST",
  "DIM_CLIENTES_HIST",
  "HECH_INVENTARIO_HIST",
  "HECH_VENTAS_HIST",
  "HECH_VENTAS_DETALLE_HIST",
  "HECH_PAGOS_HIST",
  "HECH_CAJAS_HIST",
] as const;

export type EntidadDestino = (typeof ENTIDADES_DESTINO)[number];

export function isEntidadDestino(value: unknown): value is EntidadDestino {
  return typeof value === "string" && (ENTIDADES_DESTINO as readonly string[]).includes(value);
}

// Tabla legacy que debe alimentar cada entidad destino. INVENTARIO alimenta
// dos entidades distintas (DIM_ARTICULOS_HIST y HECH_INVENTARIO_HIST), por
// eso el DTO exige entidadDestino ademas de tablaOrigen.
export const ENTIDAD_TABLA_ORIGEN: Record<EntidadDestino, string> = {
  DIM_ARTICULOS_HIST: "INVENTARIO",
  DIM_CLIENTES_HIST: "CLIENTES",
  HECH_INVENTARIO_HIST: "INVENTARIO",
  HECH_VENTAS_HIST: "VENTAS",
  HECH_VENTAS_DETALLE_HIST: "MOVVENTAS",
  HECH_PAGOS_HIST: "PAGOSVENTA",
  HECH_CAJAS_HIST: "DIARIOCAJA",
};

export const OPERACIONES_VALIDAS = ["SNAPSHOT", "INSERT", "UPDATE", "DELETE"] as const;
export type OperacionHist = (typeof OPERACIONES_VALIDAS)[number];

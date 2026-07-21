// Serializacion de pk_origen para el envio hacia bodega-api.
// Reglas fijas (no cambiar despues de implementado, invalidaria el
// historial ya cargado): string, trim, fechas yyyy-MM-dd, null -> <NULL>,
// separador "|".

export const PK_ORIGEN_NULL_TOKEN = "<NULL>";
export const PK_ORIGEN_SEPARATOR = "|";

export type PkOrigenPart = string | number | bigint | Date | null | undefined;

export function serializePkOrigen(parts: PkOrigenPart[]): string {
  return parts.map(normalizePkOrigenPart).join(PK_ORIGEN_SEPARATOR);
}

function normalizePkOrigenPart(part: PkOrigenPart): string {
  if (part === null || part === undefined) {
    return PK_ORIGEN_NULL_TOKEN;
  }

  if (part instanceof Date) {
    return formatDateOnly(part);
  }

  return String(part).trim();
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

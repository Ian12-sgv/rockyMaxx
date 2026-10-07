export const GASTO_CATEGORIAS = [
  "ALQUILER",
  "SERVICIOS",
  "NOMINA",
  "MANTENIMIENTO",
  "LIMPIEZA",
  "TRANSPORTE",
  "PAPELERIA",
  "IMPUESTOS",
  "OTROS",
] as const;

export const GASTO_MONEDAS = ["BS", "USD"] as const;

export const GASTO_STATUS_ACTIVO = 1;
export const GASTO_STATUS_ANULADO = 0;

export function toTrimmedString(value: unknown) {
  return String(value ?? "").trim();
}

export function toUpperTrimmedString(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function toOptionalTrimmedString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

export function toOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const normalized = Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(normalized) ? normalized : undefined;
}

export function toOptionalBoolean(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "si", "yes", "on"].includes(String(value).trim().toLowerCase());
}

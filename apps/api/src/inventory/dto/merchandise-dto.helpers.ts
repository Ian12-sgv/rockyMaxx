export const decimalPattern = /^-?\d+(\.\d+)?$/;

export function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

export function toUpperTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

export function toOptionalNumericString(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return String(value).trim();
}

export function toOptionalBoolean(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "si", "s", "activo", "activa", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "inactivo", "inactiva"].includes(normalized)) {
    return false;
  }

  return value;
}

export function toOptionalInt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return Number.parseInt(String(value).trim(), 10);
}

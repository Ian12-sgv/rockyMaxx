export function toTrimmedString(value: unknown) {
  return String(value ?? "").trim();
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

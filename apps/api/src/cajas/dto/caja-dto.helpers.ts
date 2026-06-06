export function toOptionalTrimmedString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

export function toUpperTrimmedString(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? normalized : undefined;
}

export function toOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

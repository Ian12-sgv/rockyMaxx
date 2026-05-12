export function toUpperTrimmedString(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function toTrimmedString(value: unknown) {
  return String(value ?? "").trim();
}

export function toOptionalTrimmedString(value: unknown) {
  const normalized = toTrimmedString(value);
  return normalized || undefined;
}

export function toOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : value;
}

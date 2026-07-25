export function toUpperTrimmedString(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function toOptionalTrimmedString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

export function toUpperTrimmedStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => toUpperTrimmedString(item));
}

export function toOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : value;
}

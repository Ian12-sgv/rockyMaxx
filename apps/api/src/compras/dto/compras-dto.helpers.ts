export function toOptionalTrimmedString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

export function toOptionalInteger(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}


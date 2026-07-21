// Normalizacion determinista para hashing. No usar Number()/parseFloat en
// ningun punto de este archivo: los montos/precios/costos/tasas/cantidades
// llegan como string exacto en payload_json y deben permanecer como string.

export const NULL_TOKEN = "<NULL>";

export function normalizeValueForHash(value: unknown): string {
  if (value === null || value === undefined) {
    return NULL_TOKEN;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return String(value).trim();
}

export function buildCanonicalString(payload: Record<string, unknown>, whitelist: readonly string[]): string {
  return whitelist.map((key) => `${key}=${normalizeValueForHash(payload[key])}`).join("|");
}

import { Prisma } from "@prisma/client";

// Convierte un valor de fila Prisma a algo serializable en JSON preservando
// exactitud: Decimal -> string (nunca Number()), BigInt -> string,
// Date -> ISO 8601. No usar Number()/parseFloat sobre montos, precios,
// costos, tasas ni cantidades en ningun punto de este archivo.
function toJsonSafeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

// Toma la fila completa (menos las columnas que ya forman parte de
// pk_origen) y la deja lista como payload. bodega-api recalcula
// hash_registro con su propia whitelist por entidadDestino; enviar columnas
// de mas no afecta el hash, asi que aqui no se duplica esa whitelist.
export function buildPayload(row: Record<string, unknown>, excludeKeys: readonly string[] = []): Record<string, unknown> {
  const exclude = new Set(excludeKeys);
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (exclude.has(key)) {
      continue;
    }
    payload[key] = toJsonSafeValue(value);
  }

  return payload;
}

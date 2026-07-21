import { createHash } from "node:crypto";

import { EntidadDestino } from "./entidades";
import { HASH_WHITELIST } from "./hash-whitelists";
import { buildCanonicalString } from "./normalize.util";

// Unica implementacion de hash_registro del sistema (vive solo aqui, en el
// servidor). El extractor de cada tienda NO calcula ni envia hash_registro;
// esto evita que tienda y VPS diverjan en el algoritmo y rompan la
// idempotencia en silencio.
export function computeHashRegistro(entidadDestino: EntidadDestino, payload: Record<string, unknown>): string {
  const whitelist = HASH_WHITELIST[entidadDestino];
  const canonical = buildCanonicalString(payload, whitelist);

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

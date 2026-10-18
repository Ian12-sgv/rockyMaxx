-- Corrige la errata del nombre de la tienda 007: "Rockymaxx CabomasCentro" -> "Rockymaxx CabimasCentro".
-- Solo de datos; no cambia el esquema. Solo toca la fila 007 si todavia tiene el texto equivocado.
UPDATE "DIM_TIENDAS"
SET "nombre" = replace("nombre", 'Cabomas', 'Cabimas'),
    "updated_at" = now()
WHERE "codigo_legacy" = '007'
  AND "nombre" LIKE '%Cabomas%';

-- Renombra la tienda 007: "Rockymaxx CabimasCentro" -> "Rockymaxx Cabimas".
-- Solo de datos; no cambia el esquema. Corre despues de 20261018020000_fix_nombre_tienda007,
-- asi que una fila que aun tuviera "Cabomas" ya llega aqui como "CabimasCentro".
UPDATE "DIM_TIENDAS"
SET "nombre" = replace("nombre", 'Rockymaxx CabimasCentro', 'Rockymaxx Cabimas'),
    "updated_at" = now()
WHERE "codigo_legacy" = '007'
  AND "nombre" LIKE '%Rockymaxx CabimasCentro%';

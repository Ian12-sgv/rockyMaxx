-- Las columnas de fecha/hora eran "timestamp without time zone": cada
-- conexion (Prisma/Node vs una sesion psql manual) puede tener una zona
-- horaria de sesion distinta, y Postgres no guarda cual se uso para
-- escribir el valor -- solo el numero "en crudo". Se confirmo que las
-- escrituras de la aplicacion (Prisma/Node, con "now()" en una sesion sin
-- zona horaria explicita) quedaron en UTC, mientras que una sesion psql
-- manual con TimeZone=America/Caracas las mostraba tal cual, dando la
-- falsa impresion de que ya estaban en hora local -- una diferencia real
-- de 4 horas que causo horas de sincronizacion "equivocadas" en los
-- reportes.
--
-- Se cambia el tipo a TIMESTAMPTZ (guarda el instante absoluto, sin
-- ambiguedad) y se usa "AT TIME ZONE 'UTC'" para reinterpretar los datos
-- YA GUARDADOS como lo que realmente eran (UTC), no como si ya fueran hora
-- de Caracas -- asi las filas historicas quedan con la hora real correcta,
-- no desplazadas otras 4 horas de mas.
--
-- Las 7 vistas VW_*_ACTUAL dependen de estas columnas (rule _RETURN), asi
-- que hay que soltarlas antes de alterar el tipo y volverlas a crear
-- exactamente igual despues (mismo texto que pg_get_viewdef mostraba antes
-- de esta migracion).

-- DropView (se recrean identicas al final de esta migracion)
DROP VIEW IF EXISTS "VW_DIM_ARTICULOS_ACTUAL";
DROP VIEW IF EXISTS "VW_DIM_CLIENTES_ACTUAL";
DROP VIEW IF EXISTS "VW_HECH_CAJAS_ACTUAL";
DROP VIEW IF EXISTS "VW_HECH_INVENTARIO_ACTUAL";
DROP VIEW IF EXISTS "VW_HECH_PAGOS_ACTUAL";
DROP VIEW IF EXISTS "VW_HECH_VENTAS_ACTUAL";
DROP VIEW IF EXISTS "VW_HECH_VENTAS_DETALLE_ACTUAL";

-- AlterTable
ALTER TABLE "BALANCE_MOVIMIENTOS"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "DIM_ARTICULOS_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "DIM_CLIENTES_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "DIM_TIENDAS"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ETL_SYNC_ERRORS"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ETL_SYNC_RUNS"
  ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(6) USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "finished_at" TYPE TIMESTAMPTZ(6) USING "finished_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ETL_WATERMARKS"
  ALTER COLUMN "last_updated_at" TYPE TIMESTAMPTZ(6) USING "last_updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "HECH_CAJAS_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "HECH_INVENTARIO_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "HECH_PAGOS_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "HECH_VENTAS_DETALLE_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "HECH_VENTAS_HIST"
  ALTER COLUMN "valido_desde" TYPE TIMESTAMPTZ(6) USING "valido_desde" AT TIME ZONE 'UTC',
  ALTER COLUMN "valido_hasta" TYPE TIMESTAMPTZ(6) USING "valido_hasta" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_extraida" TYPE TIMESTAMPTZ(6) USING "fecha_extraida" AT TIME ZONE 'UTC',
  ALTER COLUMN "fecha_cargada" TYPE TIMESTAMPTZ(6) USING "fecha_cargada" AT TIME ZONE 'UTC';

-- RecreateView (identicas a como estaban antes de esta migracion)
CREATE VIEW "VW_DIM_ARTICULOS_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "DIM_ARTICULOS_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

CREATE VIEW "VW_DIM_CLIENTES_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "DIM_CLIENTES_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

CREATE VIEW "VW_HECH_CAJAS_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "HECH_CAJAS_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

CREATE VIEW "VW_HECH_INVENTARIO_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "HECH_INVENTARIO_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

CREATE VIEW "VW_HECH_PAGOS_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "HECH_PAGOS_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

CREATE VIEW "VW_HECH_VENTAS_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "HECH_VENTAS_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

CREATE VIEW "VW_HECH_VENTAS_DETALLE_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "HECH_VENTAS_DETALLE_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

-- GASTOS de las tiendas (apps/api dbo."GASTOS") hacia bodega_datos, por el
-- mismo camino que ventas/inventario (bodega-export -> POST /bodega/ingest).
-- Solo crea objetos nuevos; no toca tablas ni datos existentes.

-- CreateTable
CREATE TABLE "HECH_GASTOS_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMPTZ(6),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMPTZ(6) NOT NULL,
    "fecha_cargada" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HECH_GASTOS_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_hech_gastos_hist_actual" ON "HECH_GASTOS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hech_gastos_hist_identidad" ON "HECH_GASTOS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- AddForeignKey
ALTER TABLE "HECH_GASTOS_HIST" ADD CONSTRAINT "HECH_GASTOS_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_GASTOS_HIST" ADD CONSTRAINT "HECH_GASTOS_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mismas garantias manuales que las demas HECH_*_HIST (ver migracion init).
ALTER TABLE "HECH_GASTOS_HIST"
  ADD CONSTRAINT "ck_hech_gastos_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_hech_gastos_hist_una_actual"
  ON "HECH_GASTOS_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

-- Vista "actual" (ultima version vigente y no borrada en origen).
CREATE VIEW "VW_HECH_GASTOS_ACTUAL" AS
SELECT h.id, h.dim_tienda_id, h.codigo_tienda_legacy, h.tabla_origen, h.pk_origen,
       h.operacion, h.hash_registro, h.payload_json, h.es_actual, h.valido_desde,
       h.valido_hasta, h.sync_run_id, h.fecha_extraida, h.fecha_cargada,
       t.codigo_legacy AS tienda_codigo_legacy, t.nombre AS tienda_nombre
FROM "HECH_GASTOS_HIST" h
JOIN "DIM_TIENDAS" t ON t.id = h.dim_tienda_id
WHERE h.es_actual = true AND h.operacion::text <> 'DELETE'::text;

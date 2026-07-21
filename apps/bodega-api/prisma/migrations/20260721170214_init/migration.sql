-- CreateTable
CREATE TABLE "DIM_TIENDAS" (
    "id" UUID NOT NULL,
    "codigo_legacy" VARCHAR(20) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(120),
    "database_name" VARCHAR(120),
    "api_path" VARCHAR(120),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DIM_TIENDAS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DIM_ARTICULOS_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DIM_ARTICULOS_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DIM_CLIENTES_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DIM_CLIENTES_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HECH_INVENTARIO_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HECH_INVENTARIO_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HECH_VENTAS_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HECH_VENTAS_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HECH_VENTAS_DETALLE_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HECH_VENTAS_DETALLE_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HECH_PAGOS_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HECH_PAGOS_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HECH_CAJAS_HIST" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200) NOT NULL,
    "operacion" VARCHAR(20) NOT NULL,
    "hash_registro" VARCHAR(64) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "es_actual" BOOLEAN NOT NULL DEFAULT true,
    "valido_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valido_hasta" TIMESTAMP(3),
    "sync_run_id" UUID NOT NULL,
    "fecha_extraida" TIMESTAMP(3) NOT NULL,
    "fecha_cargada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HECH_CAJAS_HIST_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ETL_SYNC_RUNS" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    "tablas_procesadas" JSONB NOT NULL DEFAULT '[]',
    "registros_leidos" INTEGER NOT NULL DEFAULT 0,
    "registros_insertados" INTEGER NOT NULL DEFAULT 0,
    "registros_actualizados" INTEGER NOT NULL DEFAULT 0,
    "registros_omitidos" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ETL_SYNC_RUNS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ETL_SYNC_ERRORS" (
    "id" UUID NOT NULL,
    "sync_run_id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "pk_origen" VARCHAR(200),
    "error_message" TEXT NOT NULL,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ETL_SYNC_ERRORS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ETL_WATERMARKS" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "codigo_tienda_legacy" VARCHAR(20) NOT NULL,
    "entidad_destino" VARCHAR(60) NOT NULL,
    "tabla_origen" VARCHAR(60) NOT NULL,
    "last_pk_origen" VARCHAR(200),
    "last_updated_at" TIMESTAMP(3),
    "last_hash" VARCHAR(64),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ETL_WATERMARKS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_dim_tiendas_codigo_legacy" ON "DIM_TIENDAS"("codigo_legacy");

-- CreateIndex
CREATE INDEX "ix_dim_articulos_hist_actual" ON "DIM_ARTICULOS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dim_articulos_hist_identidad" ON "DIM_ARTICULOS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_dim_clientes_hist_actual" ON "DIM_CLIENTES_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dim_clientes_hist_identidad" ON "DIM_CLIENTES_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_hech_inventario_hist_actual" ON "HECH_INVENTARIO_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hech_inventario_hist_identidad" ON "HECH_INVENTARIO_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_hech_ventas_hist_actual" ON "HECH_VENTAS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hech_ventas_hist_identidad" ON "HECH_VENTAS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_hech_ventas_detalle_hist_actual" ON "HECH_VENTAS_DETALLE_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hech_ventas_detalle_hist_identidad" ON "HECH_VENTAS_DETALLE_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_hech_pagos_hist_actual" ON "HECH_PAGOS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hech_pagos_hist_identidad" ON "HECH_PAGOS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_hech_cajas_hist_actual" ON "HECH_CAJAS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "es_actual");

-- CreateIndex
CREATE UNIQUE INDEX "uq_hech_cajas_hist_identidad" ON "HECH_CAJAS_HIST"("dim_tienda_id", "tabla_origen", "pk_origen", "hash_registro");

-- CreateIndex
CREATE INDEX "ix_etl_sync_runs_tienda_started" ON "ETL_SYNC_RUNS"("dim_tienda_id", "started_at");

-- CreateIndex
CREATE INDEX "ix_etl_sync_errors_tienda_tabla" ON "ETL_SYNC_ERRORS"("dim_tienda_id", "tabla_origen", "created_at");

-- CreateIndex
CREATE INDEX "ix_etl_sync_errors_run" ON "ETL_SYNC_ERRORS"("sync_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_etl_watermarks_tienda_entidad" ON "ETL_WATERMARKS"("dim_tienda_id", "entidad_destino");

-- AddForeignKey
ALTER TABLE "DIM_ARTICULOS_HIST" ADD CONSTRAINT "DIM_ARTICULOS_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DIM_ARTICULOS_HIST" ADD CONSTRAINT "DIM_ARTICULOS_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DIM_CLIENTES_HIST" ADD CONSTRAINT "DIM_CLIENTES_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DIM_CLIENTES_HIST" ADD CONSTRAINT "DIM_CLIENTES_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_INVENTARIO_HIST" ADD CONSTRAINT "HECH_INVENTARIO_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_INVENTARIO_HIST" ADD CONSTRAINT "HECH_INVENTARIO_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_VENTAS_HIST" ADD CONSTRAINT "HECH_VENTAS_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_VENTAS_HIST" ADD CONSTRAINT "HECH_VENTAS_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_VENTAS_DETALLE_HIST" ADD CONSTRAINT "HECH_VENTAS_DETALLE_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_VENTAS_DETALLE_HIST" ADD CONSTRAINT "HECH_VENTAS_DETALLE_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_PAGOS_HIST" ADD CONSTRAINT "HECH_PAGOS_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_PAGOS_HIST" ADD CONSTRAINT "HECH_PAGOS_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_CAJAS_HIST" ADD CONSTRAINT "HECH_CAJAS_HIST_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HECH_CAJAS_HIST" ADD CONSTRAINT "HECH_CAJAS_HIST_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ETL_SYNC_RUNS" ADD CONSTRAINT "ETL_SYNC_RUNS_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ETL_SYNC_ERRORS" ADD CONSTRAINT "ETL_SYNC_ERRORS_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ETL_SYNC_RUNS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ETL_SYNC_ERRORS" ADD CONSTRAINT "ETL_SYNC_ERRORS_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ETL_WATERMARKS" ADD CONSTRAINT "ETL_WATERMARKS_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =========================================================================
-- SQL manual (fuera del alcance de Prisma Migrate): CHECK constraints sobre
-- columnas string tipo-enum, e indices parciales que garantizan una sola
-- version "actual" por registro origen. Prisma schema no puede expresar
-- ninguno de los dos de forma nativa.
-- =========================================================================

ALTER TABLE "DIM_TIENDAS"
  ADD CONSTRAINT "ck_dim_tiendas_tipo" CHECK ("tipo" IN ('TIENDA', 'BODEGA'));

ALTER TABLE "ETL_SYNC_RUNS"
  ADD CONSTRAINT "ck_etl_sync_runs_status" CHECK ("status" IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'));

ALTER TABLE "DIM_ARTICULOS_HIST"
  ADD CONSTRAINT "ck_dim_articulos_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_dim_articulos_hist_una_actual"
  ON "DIM_ARTICULOS_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

ALTER TABLE "DIM_CLIENTES_HIST"
  ADD CONSTRAINT "ck_dim_clientes_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_dim_clientes_hist_una_actual"
  ON "DIM_CLIENTES_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

ALTER TABLE "HECH_INVENTARIO_HIST"
  ADD CONSTRAINT "ck_hech_inventario_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_hech_inventario_hist_una_actual"
  ON "HECH_INVENTARIO_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

ALTER TABLE "HECH_VENTAS_HIST"
  ADD CONSTRAINT "ck_hech_ventas_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_hech_ventas_hist_una_actual"
  ON "HECH_VENTAS_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

ALTER TABLE "HECH_VENTAS_DETALLE_HIST"
  ADD CONSTRAINT "ck_hech_ventas_detalle_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_hech_ventas_detalle_hist_una_actual"
  ON "HECH_VENTAS_DETALLE_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

ALTER TABLE "HECH_PAGOS_HIST"
  ADD CONSTRAINT "ck_hech_pagos_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_hech_pagos_hist_una_actual"
  ON "HECH_PAGOS_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

ALTER TABLE "HECH_CAJAS_HIST"
  ADD CONSTRAINT "ck_hech_cajas_hist_operacion" CHECK ("operacion" IN ('SNAPSHOT', 'INSERT', 'UPDATE', 'DELETE'));
CREATE UNIQUE INDEX "uq_hech_cajas_hist_una_actual"
  ON "HECH_CAJAS_HIST" ("dim_tienda_id", "tabla_origen", "pk_origen")
  WHERE "es_actual" = TRUE;

-- =========================================================================
-- Vistas *_ACTUAL (SQL manual, segun instruccion explicita).
-- "Actual" = ultima version vigente y no borrada en origen.
-- =========================================================================

CREATE VIEW "VW_DIM_ARTICULOS_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "DIM_ARTICULOS_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

CREATE VIEW "VW_DIM_CLIENTES_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "DIM_CLIENTES_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

CREATE VIEW "VW_HECH_INVENTARIO_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "HECH_INVENTARIO_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

CREATE VIEW "VW_HECH_VENTAS_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "HECH_VENTAS_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

CREATE VIEW "VW_HECH_VENTAS_DETALLE_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "HECH_VENTAS_DETALLE_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

CREATE VIEW "VW_HECH_PAGOS_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "HECH_PAGOS_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

CREATE VIEW "VW_HECH_CAJAS_ACTUAL" AS
SELECT h.*, t."codigo_legacy" AS "tienda_codigo_legacy", t."nombre" AS "tienda_nombre"
FROM "HECH_CAJAS_HIST" h
JOIN "DIM_TIENDAS" t ON t."id" = h."dim_tienda_id"
WHERE h."es_actual" = TRUE AND h."operacion" <> 'DELETE';

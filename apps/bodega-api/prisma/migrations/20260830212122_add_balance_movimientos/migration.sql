-- CreateTable
CREATE TABLE "BALANCE_MOVIMIENTOS" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "es_operativo" BOOLEAN NOT NULL DEFAULT false,
    "monto" DECIMAL(18,2) NOT NULL,
    "descripcion" VARCHAR(300) NOT NULL,
    "fecha" DATE NOT NULL,
    "registrado_por" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BALANCE_MOVIMIENTOS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BALANCE_MOVIMIENTOS_TIENDAS" (
    "id" UUID NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,

    CONSTRAINT "BALANCE_MOVIMIENTOS_TIENDAS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_balance_movimientos_fecha_tipo" ON "BALANCE_MOVIMIENTOS"("fecha", "tipo");

-- CreateIndex
CREATE INDEX "ix_balance_mov_tienda_tienda" ON "BALANCE_MOVIMIENTOS_TIENDAS"("dim_tienda_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_balance_mov_tienda" ON "BALANCE_MOVIMIENTOS_TIENDAS"("movimiento_id", "dim_tienda_id");

-- AddForeignKey
ALTER TABLE "BALANCE_MOVIMIENTOS_TIENDAS" ADD CONSTRAINT "BALANCE_MOVIMIENTOS_TIENDAS_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "BALANCE_MOVIMIENTOS"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BALANCE_MOVIMIENTOS_TIENDAS" ADD CONSTRAINT "BALANCE_MOVIMIENTOS_TIENDAS_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

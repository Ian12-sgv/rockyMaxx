-- CreateTable
CREATE TABLE "NODO_DIAGNOSTICO" (
    "id" UUID NOT NULL,
    "dim_tienda_id" UUID NOT NULL,
    "diagnostico_json" JSONB NOT NULL,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NODO_DIAGNOSTICO_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NODO_DIAGNOSTICO_dim_tienda_id_key" ON "NODO_DIAGNOSTICO"("dim_tienda_id");

-- AddForeignKey
ALTER TABLE "NODO_DIAGNOSTICO" ADD CONSTRAINT "NODO_DIAGNOSTICO_dim_tienda_id_fkey" FOREIGN KEY ("dim_tienda_id") REFERENCES "DIM_TIENDAS"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


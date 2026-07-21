import { PrismaClient } from "../generated/prisma-client";

const prisma = new PrismaClient();

type SeedTienda = {
  codigoLegacy: string;
  tipo: "TIENDA" | "BODEGA";
  nombre: string;
  databaseName: string;
  apiPath: string;
};

const TIENDAS: SeedTienda[] = [
  { codigoLegacy: "001", tipo: "TIENDA", nombre: "Tienda 001", databaseName: "rocky_tienda_001", apiPath: "/tienda001" },
  { codigoLegacy: "002", tipo: "TIENDA", nombre: "Tienda 002", databaseName: "rocky_tienda_002", apiPath: "/tienda002" },
  { codigoLegacy: "003", tipo: "TIENDA", nombre: "Tienda 003", databaseName: "rocky_tienda_003", apiPath: "/tienda003" },
  { codigoLegacy: "004", tipo: "TIENDA", nombre: "Tienda 004", databaseName: "rocky_tienda_004", apiPath: "/tienda004" },
  { codigoLegacy: "005", tipo: "TIENDA", nombre: "Tienda 005", databaseName: "rocky_tienda_005", apiPath: "/tienda005" },
  { codigoLegacy: "006", tipo: "TIENDA", nombre: "Tienda 006", databaseName: "rocky_tienda_006", apiPath: "/tienda006" },
  { codigoLegacy: "B002", tipo: "BODEGA", nombre: "Bodega 002", databaseName: "rocky_bodega_002", apiPath: "/bodega002" },
];

async function main() {
  for (const tienda of TIENDAS) {
    await prisma.dimTiendas.upsert({
      where: { codigoLegacy: tienda.codigoLegacy },
      update: {
        tipo: tienda.tipo,
        nombre: tienda.nombre,
        databaseName: tienda.databaseName,
        apiPath: tienda.apiPath,
      },
      create: {
        codigoLegacy: tienda.codigoLegacy,
        tipo: tienda.tipo,
        nombre: tienda.nombre,
        databaseName: tienda.databaseName,
        apiPath: tienda.apiPath,
        activa: true,
      },
    });
  }

  console.log(`DIM_TIENDAS sembrada: ${TIENDAS.length} filas (upsert por codigo_legacy).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

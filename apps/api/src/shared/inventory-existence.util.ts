import { Prisma, type Inventario } from "@prisma/client";

export type InventoryExistenceTransactionClient = Prisma.TransactionClient;

/**
 * Aplica un delta de existencia (venta descuenta, devolucion reintegra) sobre un lote de
 * articulos ya cargados en memoria. Comparte la logica entre facturacion (venta) e
 * invoice-returns (devolucion) para que ambos flujos muevan el inventario de la misma forma.
 */
export async function applyInventoryExistenceDelta(
  tx: InventoryExistenceTransactionClient,
  inventoryByCode: Map<string, Inventario>,
  quantitiesByCode: Map<string, Prisma.Decimal>,
  movementDate: Date,
  direction: "increase" | "decrease",
) {
  for (const [codigoBarra, quantity] of quantitiesByCode.entries()) {
    const inventory = inventoryByCode.get(codigoBarra);
    if (!inventory) {
      continue;
    }

    const nextExistencia =
      direction === "increase" ? inventory.Existencia.plus(quantity) : inventory.Existencia.minus(quantity);

    await tx.inventario.update({
      where: {
        CodigoBarra: inventory.CodigoBarra,
      },
      data: {
        Existencia: nextExistencia,
        FechaPrimerMovimiento: inventory.FechaPrimerMovimiento ?? movementDate,
        UltimaActualizacion: movementDate,
      },
    });
  }
}

export function sumQuantitiesByCode(
  items: Array<{ codigoBarra: string; cantidad: Prisma.Decimal }>,
): Map<string, Prisma.Decimal> {
  const totals = new Map<string, Prisma.Decimal>();
  const zero = new Prisma.Decimal(0);
  for (const line of items) {
    const current = totals.get(line.codigoBarra) ?? zero;
    totals.set(line.codigoBarra, current.plus(line.cantidad));
  }

  return totals;
}

import { Prisma } from "@prisma/client";

const DEFAULT_PROMOTION_DATE = "2000-01-01T00:00:00.000Z";

const TYPE_LABELS: Record<number, string> = {
  0: "articulo",
  1: "servicio",
};

const STATUS_LABELS: Record<number, string> = {
  0: "inactivo",
  1: "activo",
};

export const inventoryInclude = Prisma.validator<Prisma.InventarioInclude>()({
  marcaRef: true,
  tallaRef: true,
  colorRef: true,
  fabricanteRef: true,
  categoriaRef: true,
  impuestoRef: true,
});

export type InventoryWithRelations = Prisma.InventarioGetPayload<{
  include: typeof inventoryInclude;
}>;

function isDefaultPromotionDate(value: Date) {
  return value.toISOString() === DEFAULT_PROMOTION_DATE;
}

function toNullableDate(active: boolean, value: Date) {
  if (!active || isDefaultPromotionDate(value)) {
    return null;
  }

  return value;
}

function toPromotionDiscount(detail: Prisma.Decimal, promotionPrice: Prisma.Decimal, active: boolean) {
  if (!active) {
    return null;
  }

  if (detail.lessThanOrEqualTo(0)) {
    return null;
  }

  const hundred = new Prisma.Decimal(100);
  const difference = detail.minus(promotionPrice);
  const percent = difference.dividedBy(detail).times(hundred);
  return percent.toDecimalPlaces(2).toString();
}

export function toInventoryView(item: InventoryWithRelations) {
  return {
    codigoBarra: item.CodigoBarra,
    codigoBarraAnt: item.CodigoBarraAnt,
    general: {
      familia: item.Referencia,
      nombre: item.Nombre,
      categoria: {
        codigo: item.categoriaRef.Codigo,
        nombre: item.categoriaRef.Nombre,
      },
      fabricante: {
        codigo: item.fabricanteRef.Codigo,
        nombre: item.fabricanteRef.Nombre,
      },
      marca: {
        codigo: item.marcaRef.Codigo,
        nombre: item.marcaRef.Nombre,
      },
      puntoRecorte: item.PuntoReorden,
      nota: item.Nota,
      tipo: {
        codigo: item.Tipo,
        nombre: TYPE_LABELS[item.Tipo] ?? `tipo-${item.Tipo}`,
      },
      status: {
        codigo: item.Status,
        nombre: STATUS_LABELS[item.Status] ?? `status-${item.Status}`,
      },
    },
    tallasColores: {
      talla: {
        codigo: item.tallaRef.Codigo,
      },
      colores: {
        codigo: item.colorRef.Codigo,
        nombre: item.colorRef.Nombre,
      },
    },
    precios: {
      impuesto: {
        codigo: item.impuestoRef.Codigo,
        nombre: item.impuestoRef.Nombre,
        porcentaje: item.impuestoRef.PorcentajeImpuesto,
      },
      detal: item.PrecioDetal,
      mayor: item.PrecioMayor,
      afiliado: item.PrecioAfiliado,
      promocion: {
        activa: item.Promocion,
        porcentajeDescuento: toPromotionDiscount(item.PrecioDetal, item.PrecioPromocion, item.Promocion),
        precio: item.PrecioPromocion,
        desde: toNullableDate(item.Promocion, item.FechaInicial),
        hasta: toNullableDate(item.Promocion, item.FechaFinal),
      },
    },
    inventario: {
      existenciaInicial: item.ExistenciaInicial,
      existenciaActual: item.Existencia,
      costos: {
        inicial: item.CostoInicial,
        promedio: item.CostoPromedio,
        ultimo: item.UltimoCosto,
        dolar: item.CostoDolar,
      },
      fechas: {
        fechaInicial: item.FechaInicial,
        fechaFinal: item.FechaFinal,
        fechaPrimerMovimiento: item.FechaPrimerMovimiento,
        ultimaActualizacion: item.UltimaActualizacion,
      },
      serializado: item.Serializado,
    },
  };
}

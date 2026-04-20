import { Prisma } from "@prisma/client";

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

export function toInventoryView(item: InventoryWithRelations) {
  return {
    codigoBarra: item.CodigoBarra,
    codigoBarraAnt: item.CodigoBarraAnt,
    referencia: item.Referencia,
    nombre: item.Nombre,
    nota: item.Nota,
    tipo: item.Tipo,
    status: item.Status,
    serializado: item.Serializado,
    promocion: item.Promocion,
    fechas: {
      fechaInicial: item.FechaInicial,
      fechaFinal: item.FechaFinal,
      fechaPrimerMovimiento: item.FechaPrimerMovimiento,
      ultimaActualizacion: item.UltimaActualizacion,
    },
    precios: {
      detal: item.PrecioDetal,
      mayor: item.PrecioMayor,
      afiliado: item.PrecioAfiliado,
      promocion: item.PrecioPromocion,
    },
    costos: {
      inicial: item.CostoInicial,
      promedio: item.CostoPromedio,
      ultimo: item.UltimoCosto,
      dolar: item.CostoDolar,
    },
    existencia: {
      inicial: item.ExistenciaInicial,
      actual: item.Existencia,
      puntoReorden: item.PuntoReorden,
    },
    marca: {
      codigo: item.marcaRef.Codigo,
      nombre: item.marcaRef.Nombre,
    },
    talla: {
      codigo: item.tallaRef.Codigo,
    },
    color: {
      codigo: item.colorRef.Codigo,
      nombre: item.colorRef.Nombre,
    },
    fabricante: {
      codigo: item.fabricanteRef.Codigo,
      nombre: item.fabricanteRef.Nombre,
    },
    categoria: {
      codigo: item.categoriaRef.Codigo,
      nombre: item.categoriaRef.Nombre,
    },
    impuesto: {
      codigo: item.impuestoRef.Codigo,
      nombre: item.impuestoRef.Nombre,
      porcentaje: item.impuestoRef.PorcentajeImpuesto,
    },
  };
}
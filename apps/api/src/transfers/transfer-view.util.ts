import { Prisma } from "@prisma/client";

const TRANSFER_STATUS_LABELS: Record<number, string> = {
  0: "no aprobada",
  1: "aprobada",
};

export const transferInclude = Prisma.validator<Prisma.TransferenciasInclude>()({
  movTransferencias: {
    orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
    include: {
      inventarioRef: {
        select: {
          CodigoBarra: true,
          Nombre: true,
          Referencia: true,
          Existencia: true,
        },
      },
    },
  },
  tipoDespacho: true,
  sucursalRecibe: true,
  usuarioRef: true,
});

export type TransferWithRelations = Prisma.TransferenciasGetPayload<{
  include: typeof transferInclude;
}>;

type TransferViewOptions = {
  codigoEnviaInfo?: {
    codigo: string;
    nombre: string | null;
    status: number | null;
  } | null;
};

function toTransferStatusName(status: number) {
  return TRANSFER_STATUS_LABELS[status] ?? `status-${status}`;
}

export function toTransferListItemView(
  item: TransferWithRelations,
  options: TransferViewOptions = {},
) {
  return {
    numero: item.Numero,
    fecha: item.Fecha,
    codigoEnvia: item.CodigoEnvia,
    codigoRecibe: item.CodigoRecibe,
    codigoEnviaInfo: options.codigoEnviaInfo
      ? {
          codigo: options.codigoEnviaInfo.codigo,
          nombre: options.codigoEnviaInfo.nombre,
          status: options.codigoEnviaInfo.status,
        }
      : null,
    codigoRecibeInfo: {
      codigo: item.sucursalRecibe.Codigo,
      nombre: item.sucursalRecibe.Nombre,
      status: item.sucursalRecibe.Status,
    },
    documentoOrigen: item.DocumentoOrigen,
    totalValor: item.TotalValor.toString(),
    observacion: item.Observacion,
    status: item.Status,
    statusNombre: toTransferStatusName(item.Status),
    usuario: item.Usuario,
    editable: item.Status === 0,
    totalItems: item.movTransferencias.length,
  };
}

export function toTransferDetailView(
  item: TransferWithRelations,
  options: TransferViewOptions = {},
) {
  return {
    ...toTransferListItemView(item, options),
    fechaEmision: item.FechaEmision,
    interContable: item.InterContable,
    idLote: item.IDLote,
    idDespacho: item.IDDespacho,
    correccion: item.Correccion,
    zona: item.Zona,
    tipoDespacho: {
      id: item.tipoDespacho.ID,
      descripcion: item.tipoDespacho.Descripcion,
      estado: item.tipoDespacho.Estado,
    },
    items: item.movTransferencias.map((line) => ({
      item: line.Item,
      fecha: line.Fecha,
      codigoBarra: line.CodigoBarra,
      cantidad: line.Cantidad.toString(),
      valor: line.Valor.toString(),
      numeroCaja: line.NumeroCaja,
      ultimoCosto: line.UltimoCosto?.toString() ?? null,
      costoInicial: line.CostoInicial?.toString() ?? null,
      costoDolar: line.CostoDolar?.toString() ?? null,
      articulo: {
        codigoBarra: line.inventarioRef.CodigoBarra,
        nombre: line.inventarioRef.Nombre,
        referencia: line.inventarioRef.Referencia,
        existenciaActual: line.inventarioRef.Existencia.toString(),
      },
    })),
  };
}

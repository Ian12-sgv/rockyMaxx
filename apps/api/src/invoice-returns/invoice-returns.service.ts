import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { applyInventoryExistenceDelta, sumQuantitiesByCode } from "../shared/inventory-existence.util";
import { UserView } from "../users/user-view.util";
import { CreateInvoiceReturnDto, InvoiceReturnLineDto } from "./dto/create-invoice-return.dto";

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

type InvoiceReturnTransactionClient = Prisma.TransactionClient;

type NormalizedReturnLine = {
  item: number;
  cantidad: Prisma.Decimal;
};

@Injectable()
export class InvoiceReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async listOpenCajaSales() {
    const openSessions = await this.prisma.diarioCaja.findMany({
      where: { Status: { in: [0, 1] } },
      select: { Serie: true },
    });
    const series = [...new Set(openSessions.map((session) => this.normalizeCode(session.Serie)))];
    if (!series.length) {
      return { items: [] };
    }

    const { start, end } = this.getTodayRange();
    const ventas = await this.prisma.ventas.findMany({
      where: {
        Serie: { in: series },
        Fecha: { gte: start, lt: end },
      },
      include: { clienteRef: true },
      orderBy: [{ Fecha: "desc" }, { NumeroFactura: "desc" }],
      take: 200,
    });

    if (!ventas.length) {
      return { items: [] };
    }

    const movVentas = await this.prisma.movVentas.findMany({
      where: {
        Serie: { in: series },
        NumeroFactura: { in: ventas.map((venta) => venta.NumeroFactura) },
      },
      select: { Serie: true, NumeroFactura: true, Cantidad: true, CantidadDevuelta: true },
    });
    const disponibleByKey = new Map<string, Prisma.Decimal>();
    for (const line of movVentas) {
      const key = `${this.normalizeCode(line.Serie)}|${line.NumeroFactura.toString()}`;
      const current = disponibleByKey.get(key) ?? ZERO;
      const disponible = Prisma.Decimal.max(line.Cantidad.minus(line.CantidadDevuelta), ZERO);
      disponibleByKey.set(key, current.plus(disponible));
    }

    return {
      items: ventas.map((venta) => {
        const key = `${this.normalizeCode(venta.Serie)}|${venta.NumeroFactura.toString()}`;
        const disponibleTotal = disponibleByKey.get(key) ?? ZERO;
        return {
          serie: venta.Serie,
          numeroFactura: venta.NumeroFactura.toString(),
          fecha: venta.Fecha,
          cliente: venta.Cliente,
          clienteNombre: venta.clienteRef?.Nombre ?? "",
          totalMercancia: venta.TotalMercancia.toString(),
          totalPago: venta.TotalPago.toString(),
          estado: disponibleTotal.greaterThan(ZERO) ? "pendiente" : "finalizada",
        };
      }),
    };
  }

  async lookupSaleForReturn(serieRaw: string, numeroFacturaRaw: string) {
    const serie = this.normalizeCode(serieRaw);
    const numeroFactura = this.parseInvoiceNumber(numeroFacturaRaw);

    const venta = await this.prisma.ventas.findUnique({
      where: {
        NumeroFactura_Serie: {
          NumeroFactura: numeroFactura,
          Serie: serie,
        },
      },
      include: {
        clienteRef: true,
        movVentas: {
          include: { inventarioRef: true },
          orderBy: { Item: "asc" },
        },
      },
    });

    if (!venta) {
      throw new NotFoundException(`No se encontro la factura ${numeroFactura.toString()} de la serie ${serie}.`);
    }

    const lineas = venta.movVentas.map((line) => {
      const disponible = Prisma.Decimal.max(line.Cantidad.minus(line.CantidadDevuelta), ZERO);
      return {
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        nombre: line.inventarioRef?.Nombre ?? line.CodigoBarra,
        precio: line.Precio.toString(),
        cantidadVendida: line.Cantidad.toString(),
        cantidadDevuelta: line.CantidadDevuelta.toString(),
        disponible: disponible.toString(),
      };
    });
    const tieneDisponible = lineas.some((line) => Number.parseFloat(line.disponible) > 0);

    return {
      serie: venta.Serie,
      numeroFactura: venta.NumeroFactura.toString(),
      fecha: venta.Fecha,
      cliente: venta.Cliente,
      clienteNombre: venta.clienteRef?.Nombre ?? "",
      vendedor: venta.Vendedor,
      estado: tieneDisponible ? "pendiente" : "finalizada",
      lineas,
    };
  }

  async searchReturns(filters: { serie?: string; limit?: string }) {
    const serie = this.normalizeCode(filters.serie);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);

    const devoluciones = await this.prisma.devVentas.findMany({
      where: serie ? { Serie: serie } : undefined,
      orderBy: [{ Fecha: "desc" }, { NumeroDevolucion: "desc" }],
      take: limit,
    });

    return {
      items: devoluciones.map((item) => ({
        numeroDevolucion: item.NumeroDevolucion.toString(),
        serie: item.Serie,
        numeroFactura: item.NumeroFactura.toString(),
        fecha: item.Fecha,
        cliente: item.Cliente,
        totalMercancia: item.TotalMercancia.toString(),
        usuario: item.Usuario,
      })),
    };
  }

  async findReturn(serieRaw: string, numeroDevolucionRaw: string) {
    const serie = this.normalizeCode(serieRaw);
    const numeroDevolucion = this.parseInvoiceNumber(numeroDevolucionRaw);

    const devolucion = await this.prisma.devVentas.findUnique({
      where: {
        NumeroDevolucion_Serie: {
          NumeroDevolucion: numeroDevolucion,
          Serie: serie,
        },
      },
      include: {
        clienteRef: true,
        movDevVentas: {
          include: { inventarioRef: true },
          orderBy: { Item: "asc" },
        },
      },
    });

    if (!devolucion) {
      throw new NotFoundException(`No se encontro la devolucion ${numeroDevolucion.toString()} de la serie ${serie}.`);
    }

    return {
      numeroDevolucion: devolucion.NumeroDevolucion.toString(),
      serie: devolucion.Serie,
      numeroFactura: devolucion.NumeroFactura.toString(),
      fecha: devolucion.Fecha,
      cliente: devolucion.Cliente,
      clienteNombre: devolucion.clienteRef?.Nombre ?? "",
      usuario: devolucion.Usuario,
      totalMercancia: devolucion.TotalMercancia.toString(),
      totalDescuento: devolucion.TotalDescuento.toString(),
      totalImpuesto: devolucion.TotalImpuesto.toString(),
      totalCosto: devolucion.TotalCosto.toString(),
      lineas: devolucion.movDevVentas.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        nombre: line.inventarioRef?.Nombre ?? line.CodigoBarra,
        precio: line.Precio.toString(),
        cantidad: line.Cantidad.toString(),
      })),
    };
  }

  async createReturn(payload: CreateInvoiceReturnDto, user: UserView) {
    const usuario = String(user?.codUsuario || "").trim();
    if (!usuario) {
      throw new BadRequestException("No se pudo identificar el usuario autenticado.");
    }

    const serie = this.normalizeCode(payload.serie);
    if (!serie) {
      throw new BadRequestException("Debes indicar la serie de la factura.");
    }

    const numeroFactura = this.parseInvoiceNumber(payload.numeroFactura);
    const requestedLines = this.normalizeReturnLines(payload.items);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const venta = await tx.ventas.findUnique({
          where: {
            NumeroFactura_Serie: {
              NumeroFactura: numeroFactura,
              Serie: serie,
            },
          },
          include: { movVentas: true },
        });
        if (!venta) {
          throw new NotFoundException(`No se encontro la factura ${numeroFactura.toString()} de la serie ${serie}.`);
        }

        const tieneDisponible = venta.movVentas.some((line) => line.Cantidad.minus(line.CantidadDevuelta).greaterThan(ZERO));
        if (!tieneDisponible) {
          throw new ConflictException(`La factura ${numeroFactura.toString()} ya fue devuelta por completo.`);
        }

        const cajaActiva = await tx.cajas.findUnique({ where: { Serie: serie } });
        if (!cajaActiva) {
          throw new NotFoundException(`No existe la caja ${serie}.`);
        }

        const movVentasByItem = new Map(venta.movVentas.map((line) => [line.Item, line]));
        const linesToReturn = requestedLines.map((requested) => {
          const original = movVentasByItem.get(requested.item);
          if (!original) {
            throw new NotFoundException(`La factura ${numeroFactura.toString()} no tiene la linea ${requested.item}.`);
          }

          const disponible = original.Cantidad.minus(original.CantidadDevuelta);
          if (requested.cantidad.greaterThan(disponible)) {
            throw new ConflictException(
              `El articulo ${original.CodigoBarra} (linea ${requested.item}) no tiene cantidad disponible para devolver. Disponible ${disponible.toString()}, solicitada ${requested.cantidad.toString()}.`,
            );
          }

          return { original, cantidad: requested.cantidad };
        });

        const codigosBarra = [...new Set(linesToReturn.map((line) => this.normalizeCode(line.original.CodigoBarra)))];
        const inventoryRecords = await tx.inventario.findMany({ where: { CodigoBarra: { in: codigosBarra } } });
        const inventoryByCode = new Map(inventoryRecords.map((item) => [this.normalizeCode(item.CodigoBarra), item]));

        for (const line of linesToReturn) {
          if (!inventoryByCode.has(this.normalizeCode(line.original.CodigoBarra))) {
            throw new NotFoundException(`El articulo ${line.original.CodigoBarra} ya no existe en inventario.`);
          }
        }

        const numeroDevolucion = await this.resolveNextReturnNumber(tx, serie, cajaActiva.UltimaDevolucion);
        const movementDate = new Date();

        const totalMercancia = linesToReturn
          .reduce((sum, line) => sum.plus(line.original.Precio.mul(line.cantidad)), ZERO)
          .toDecimalPlaces(2);
        const totalDescuento = linesToReturn
          .reduce((sum, line) => {
            const lineSubtotal = line.original.Precio.mul(line.cantidad);
            return sum.plus(lineSubtotal.mul(line.original.PorcentajeDescuento).div(HUNDRED));
          }, ZERO)
          .toDecimalPlaces(2);
        const totalImpuesto = linesToReturn
          .reduce((sum, line) => {
            const proportion = line.original.Cantidad.greaterThan(ZERO)
              ? line.cantidad.div(line.original.Cantidad)
              : ZERO;
            return sum.plus(line.original.Impuesto.mul(proportion));
          }, ZERO)
          .toDecimalPlaces(2);
        const totalCosto = linesToReturn
          .reduce((sum, line) => sum.plus(line.original.Costo.mul(line.cantidad)), ZERO)
          .toDecimalPlaces(2);

        await tx.devVentas.create({
          data: {
            NumeroDevolucion: numeroDevolucion,
            Serie: serie,
            NumeroFactura: numeroFactura,
            Fecha: movementDate,
            Vendedor: venta.Vendedor,
            Cliente: venta.Cliente,
            TipoVenta: venta.TipoVenta,
            TotalMercancia: totalMercancia,
            TotalDescuento: totalDescuento,
            TotalImpuesto: totalImpuesto,
            TotalCosto: totalCosto,
            InterContable: 0,
            Usuario: usuario,
            Status: 1,
            SerieFactura: serie,
            Estacion: venta.Estacion,
            TasaIGTF: ZERO,
            MontoIGTF: ZERO,
            BaseImponibleIGTF: ZERO,
          },
        });

        let itemCounter = 0;
        for (const line of linesToReturn) {
          itemCounter += 1;
          await tx.movDevVentas.create({
            data: {
              NumeroDevolucion: numeroDevolucion,
              Serie: serie,
              Item: itemCounter,
              Hora: movementDate,
              TipoLista: line.original.TipoLista,
              CodigoBarra: line.original.CodigoBarra,
              Precio: line.original.Precio,
              PrecioLista: line.original.PrecioLista,
              Costo: line.original.Costo,
              Impuesto: line.original.Impuesto,
              PorcentajeImpuesto: line.original.PorcentajeImpuesto,
              Cantidad: line.cantidad,
              PorcentajeDescuento: line.original.PorcentajeDescuento,
            },
          });

          await tx.movVentas.update({
            where: {
              NumeroFactura_Serie_Item: {
                NumeroFactura: numeroFactura,
                Serie: serie,
                Item: line.original.Item,
              },
            },
            data: {
              CantidadDevuelta: line.original.CantidadDevuelta.plus(line.cantidad),
            },
          });
        }

        const quantitiesByCode = sumQuantitiesByCode(
          linesToReturn.map((line) => ({
            codigoBarra: this.normalizeCode(line.original.CodigoBarra),
            cantidad: line.cantidad,
          })),
        );
        await applyInventoryExistenceDelta(tx, inventoryByCode, quantitiesByCode, movementDate, "increase");

        await tx.cajas.update({
          where: { Serie: serie },
          data: { UltimaDevolucion: numeroDevolucion },
        });

        await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, codigosBarra);
        await this.mirrorSyncService.enqueueVentaUpsertTx(tx, numeroFactura, serie);

        return {
          numeroDevolucion: numeroDevolucion.toString(),
          serie,
          numeroFactura: numeroFactura.toString(),
          fecha: movementDate,
          cliente: venta.Cliente,
          usuario,
          motivo: payload.motivo || "",
          totalMercancia: totalMercancia.toString(),
          totalDescuento: totalDescuento.toString(),
          totalImpuesto: totalImpuesto.toString(),
          totalCosto: totalCosto.toString(),
          lineas: linesToReturn.map((line) => ({
            item: line.original.Item,
            codigoBarra: line.original.CodigoBarra,
            cantidad: line.cantidad.toString(),
            precio: line.original.Precio.toString(),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    return result;
  }

  private async resolveNextReturnNumber(
    tx: InvoiceReturnTransactionClient,
    serie: string,
    ultimaDevolucionCajaRaw: bigint | null | undefined,
  ) {
    const aggregate = await tx.devVentas.aggregate({
      where: { Serie: serie },
      _max: { NumeroDevolucion: true },
    });

    const ultimaDevolucionCaja = BigInt(ultimaDevolucionCajaRaw?.toString() ?? "0");
    const ultimaDevolucionRegistrada = BigInt(aggregate._max.NumeroDevolucion?.toString() ?? "0");
    const currentMax = ultimaDevolucionCaja > ultimaDevolucionRegistrada ? ultimaDevolucionCaja : ultimaDevolucionRegistrada;

    return currentMax + 1n;
  }

  private normalizeReturnLines(items: InvoiceReturnLineDto[]): NormalizedReturnLine[] {
    const rows = Array.isArray(items) ? items : [];
    const normalized = rows.map((row, index) => {
      const itemNumber = Number(row?.item);
      if (!Number.isInteger(itemNumber) || itemNumber < 1) {
        throw new BadRequestException(`La linea ${index + 1} no tiene un numero de item valido.`);
      }

      const cantidad = this.parseDecimalInput(row?.cantidad, `La cantidad a devolver de la linea ${itemNumber} no es valida.`);
      if (cantidad.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException(`La cantidad a devolver de la linea ${itemNumber} debe ser mayor a cero.`);
      }

      return { item: itemNumber, cantidad };
    });

    if (!normalized.length) {
      throw new BadRequestException("Debes seleccionar al menos un articulo para devolver.");
    }

    return normalized;
  }

  private parseDecimalInput(value: unknown, message: string) {
    const sanitized = String(value ?? "").trim().replace(/\s+/g, "");
    if (!sanitized) {
      throw new BadRequestException(message);
    }

    const commaIndex = sanitized.lastIndexOf(",");
    const dotIndex = sanitized.lastIndexOf(".");
    let normalized = sanitized;

    if (commaIndex >= 0 && dotIndex >= 0) {
      normalized = commaIndex > dotIndex ? sanitized.replace(/\./g, "").replace(",", ".") : sanitized.replace(/,/g, "");
    } else if (commaIndex >= 0) {
      normalized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }

    try {
      const decimal = new Prisma.Decimal(normalized);
      if (decimal.lessThan(ZERO)) {
        throw new Error("negative");
      }
      return decimal;
    } catch {
      throw new BadRequestException(message);
    }
  }

  private parseInvoiceNumber(value: string) {
    const sanitized = String(value ?? "").trim();
    if (!/^\d+$/.test(sanitized)) {
      throw new BadRequestException("El numero de factura no es valido.");
    }

    return BigInt(sanitized);
  }

  private normalizeCode(value: string | null | undefined) {
    return String(value || "").trim().toUpperCase();
  }

  private getTodayRange() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Cajas, type FormaPago } from "@prisma/client";

import {
  buildCashRegisterCloseReportPdf,
  buildCashRegisterGeneralCloseReportPdf,
  createEmptyCashRegisterPaymentSummary,
  mergeCashRegisterPaymentSummary,
  parseCashRegisterPaymentSummary,
  serializeCashRegisterPaymentSummary,
} from "./caja-close-report.util";
import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { toCajaConfigView, toCajaView } from "./caja-view.util";
import { CreateCajaDto } from "./dto/create-caja.dto";
import { FindCajasDto } from "./dto/find-cajas.dto";
import { UpdateCajaDto } from "./dto/update-caja.dto";
import { CloseCajaDto } from "./dto/close-caja.dto";

const ZERO = new Prisma.Decimal(0);

type CajaTransactionClient = Prisma.TransactionClient;
type CajaSessionRecord = Prisma.DiarioCajaGetPayload<{ include: { caja: true } }>;

type NormalizedCajaInput = {
  serie: string;
  fecha: Date;
  numeroCaja: number;
  facturaInicial: bigint;
  ultimaFactura: bigint;
  horaApertura: string;
  horaCierre?: string;
  nombreImpresora?: string;
};

@Injectable()
export class CajasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mirrorSyncService: MirrorSyncService,
    private readonly configService: ConfigService,
  ) {}

  async getMetadata() {
    const cajas = await this.prisma.cajas.findMany({
      orderBy: [{ Numero: "asc" }, { Serie: "asc" }],
    });

    const nextNumeroCaja = cajas.length
      ? Math.max(...cajas.map((item) => Number(item.Numero || 0))) + 1
      : 1;
    const ultimaFacturaGlobal = cajas.reduce<bigint>((max, item) => {
      const current = BigInt(item.UltimaFactura?.toString() ?? "0");
      return current > max ? current : max;
    }, 0n);

    return {
      defaults: {
        fecha: this.startOfDay(new Date()),
        numeroCaja: nextNumeroCaja,
        facturaInicial: (ultimaFacturaGlobal + 1n).toString(),
        ultimaFactura: ultimaFacturaGlobal.toString(),
        horaApertura: this.formatTime(new Date()),
        horaCierre: "",
        status: 0,
      },
      series: cajas.map((item) => toCajaConfigView(item)),
    };
  }

  async findAll(findCajasDto: FindCajasDto) {
    const items = await this.prisma.diarioCaja.findMany({
      where: this.buildWhere(findCajasDto),
      include: { caja: true },
      orderBy: [{ Fecha: "desc" }, { Serie: "asc" }],
      take: findCajasDto.limit ?? 100,
    });

    const syncedItems = await Promise.all(items.map((item) => this.syncCajaSessionState(item)));
    return syncedItems.map((item) => toCajaView(item));
  }

  async findOne(serie: string, fecha: string) {
    const caja = await this.findCajaSessionOrThrow(serie, fecha);
    const syncedCaja = await this.syncCajaSessionState(caja);
    return toCajaView(syncedCaja);
  }

  async create(createCajaDto: CreateCajaDto) {
    const normalized = this.normalizeInput(createCajaDto);

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.ensureCajaConfig(tx, normalized);

        const existing = await tx.diarioCaja.findUnique({
          where: {
            Serie_Fecha: {
              Serie: normalized.serie,
              Fecha: normalized.fecha,
            },
          },
        });

        if (existing) {
          throw new ConflictException("Ya existe una caja para esa serie y fecha.");
        }

        const openForSerie = await tx.diarioCaja.findFirst({
          where: {
            Serie: normalized.serie,
            Status: { not: 2 },
          },
        });

        if (openForSerie) {
          throw new ConflictException("Ya existe una caja abierta con ese número de serie.");
        }

        const derivedState = await this.resolveDerivedCajaState(tx, normalized.serie, normalized.fecha, 0, normalized.ultimaFactura);
        this.validateFacturaRange(normalized.facturaInicial, derivedState.status, derivedState.ultimaFactura);

        return tx.diarioCaja.create({
          data: {
            Serie: normalized.serie,
            Fecha: normalized.fecha,
            Numero: normalized.numeroCaja,
            FacturaInicial: normalized.facturaInicial,
            FacturaFinal: derivedState.ultimaFactura,
            PorcentajeImpuesto: ZERO,
            HoraApertura: this.combineDateAndTime(normalized.fecha, normalized.horaApertura),
            HoraCierre: normalized.horaCierre
              ? this.combineDateAndTime(normalized.fecha, normalized.horaCierre)
              : null,
            NumeroReporteZ: ZERO,
            Status: derivedState.status,
            ReporteZTexto: serializeCashRegisterPaymentSummary(createEmptyCashRegisterPaymentSummary()),
            Acumulado: ZERO,
          },
          include: { caja: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return toCajaView(created);
  }

  async update(serie: string, fecha: string, updateCajaDto: UpdateCajaDto) {
    const normalized = this.normalizeInput({
      ...updateCajaDto,
      serie,
      fecha: this.parseDateKey(fecha),
    });

    const updated = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.diarioCaja.findUnique({
          where: {
            Serie_Fecha: {
              Serie: normalized.serie,
              Fecha: normalized.fecha,
            },
          },
          include: { caja: true },
        });

        if (!existing) {
          throw new NotFoundException("La caja no existe.");
        }

        if (existing.Status === 2) {
          throw new ConflictException("La caja ya esta cerrada y no puede modificarse.");
        }

        await this.ensureCajaConfig(tx, normalized, existing.caja ?? undefined);
        const derivedState = await this.resolveDerivedCajaState(
          tx,
          normalized.serie,
          normalized.fecha,
          existing.Status,
          normalized.ultimaFactura,
        );
        this.validateFacturaRange(normalized.facturaInicial, derivedState.status, derivedState.ultimaFactura);

        return tx.diarioCaja.update({
          where: {
            Serie_Fecha: {
              Serie: normalized.serie,
              Fecha: normalized.fecha,
            },
          },
          data: {
            Numero: normalized.numeroCaja,
            FacturaInicial: normalized.facturaInicial,
            FacturaFinal: derivedState.ultimaFactura,
            HoraApertura: this.combineDateAndTime(normalized.fecha, normalized.horaApertura),
            HoraCierre: normalized.horaCierre
              ? this.combineDateAndTime(normalized.fecha, normalized.horaCierre)
              : null,
            Status: derivedState.status,
          },
          include: { caja: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return toCajaView(updated);
  }
  async close(serie: string, fecha: string, closeCajaDto: CloseCajaDto) {
    const normalizedSerie = this.normalizeSerie(serie);
    const normalizedFecha = this.parseDateKey(fecha);
    const horaCierre = this.normalizeTime(closeCajaDto?.horaCierre) ?? this.formatTime(new Date());

    const closed = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.diarioCaja.findUnique({
          where: {
            Serie_Fecha: {
              Serie: normalizedSerie,
              Fecha: normalizedFecha,
            },
          },
          include: { caja: true },
        });

        if (!existing) {
          throw new NotFoundException("La caja no existe.");
        }

        if (existing.Status === 2) {
          throw new ConflictException("La caja ya esta cerrada.");
        }

        const derivedState = await this.resolveDerivedCajaState(
          tx,
          existing.Serie,
          existing.Fecha,
          existing.Status,
          BigInt(existing.FacturaFinal?.toString() ?? "0"),
        );

        return tx.diarioCaja.update({
          where: {
            Serie_Fecha: {
              Serie: normalizedSerie,
              Fecha: normalizedFecha,
            },
          },
          data: {
            FacturaFinal: derivedState.ultimaFactura,
            HoraCierre: this.combineDateAndTime(normalizedFecha, horaCierre),
            Status: 2,
          },
          include: { caja: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const reporte = await this.buildCloseReportPayload(closed as CajaSessionRecord);
    return {
      caja: toCajaView(closed),
      reporte,
    };
  }
  async remove(serie: string, fecha: string) {
    const normalizedSerie = this.normalizeSerie(serie);
    const normalizedFecha = this.parseDateKey(fecha);

    const existing = await this.prisma.diarioCaja.findUnique({
      where: {
        Serie_Fecha: {
          Serie: normalizedSerie,
          Fecha: normalizedFecha,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException("La caja no existe.");
    }

    const derivedState = await this.resolveDerivedCajaState(
      this.prisma,
      existing.Serie,
      existing.Fecha,
      existing.Status,
      BigInt(existing.FacturaFinal?.toString() ?? "0"),
    );

    if (derivedState.status !== 0) {
      throw new ConflictException("Solo se puede eliminar una caja en status 0.");
    }

    await this.prisma.diarioCaja.delete({
      where: {
        Serie_Fecha: {
          Serie: normalizedSerie,
          Fecha: normalizedFecha,
        },
      },
    });
  }

  async buildGeneralCloseReport(fecha: string) {
    const normalizedFecha = this.parseDateKey(fecha);
    const { start, end } = this.getDayRange(normalizedFecha);

    const items = await this.prisma.diarioCaja.findMany({
      where: {
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      include: { caja: true },
      orderBy: [{ Numero: "asc" }, { Serie: "asc" }],
    });

    const syncedItems = await Promise.all(items.map((item) => this.syncCajaSessionState(item)));
    const salesAggregate = await this.prisma.ventas.aggregate({
      where: {
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        TotalMercancia: true,
        TotalDescuento: true,
        TotalImpuesto: true,
        TotalPago: true,
        TotalDolares: true,
      },
    });
    const devolucionesAggregate = await this.prisma.devVentas.aggregate({
      where: {
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        TotalMercancia: true,
      },
    });

    let mergedSummary = createEmptyCashRegisterPaymentSummary();
    const fallbackSeries = new Set<string>();

    for (const item of syncedItems) {
      const parsedSummary = parseCashRegisterPaymentSummary(item.ReporteZTexto);
      if (parsedSummary.payments.length) {
        mergedSummary = mergeCashRegisterPaymentSummary(
          mergedSummary,
          parsedSummary.payments.map((entry) => ({
            label: entry.label,
            totalVed: entry.totalVed,
            totalUsd: entry.totalUsd,
            movimientos: Number(entry.movimientos || 0),
          })),
        );
        continue;
      }

      fallbackSeries.add(item.Serie);
    }

    const fallbackBreakdown = await this.buildFallbackGeneralCloseBreakdown([...fallbackSeries], start, end);
    if (fallbackBreakdown.length) {
      mergedSummary = mergeCashRegisterPaymentSummary(mergedSummary, fallbackBreakdown);
    }

    const [tasaCierreUsd, inventoryCost] = await Promise.all([
      this.resolveGeneralCloseUsdRate(start, end),
      this.calculateGeneralCloseInventoryCost(start, end),
    ]);
    const breakdown = mergedSummary.payments.map((entry) => {
      const totalVed = new Prisma.Decimal(entry.totalVed || 0);
      const totalUsd = new Prisma.Decimal(entry.totalUsd || 0);
      const displayUsd = totalUsd.greaterThan(ZERO)
        ? totalUsd
        : totalVed.greaterThan(ZERO) && tasaCierreUsd.greaterThan(ZERO)
          ? totalVed.div(tasaCierreUsd).toDecimalPlaces(2)
          : ZERO;

      return {
        label: entry.label,
        totalVed: this.formatDecimal(entry.totalVed),
        totalUsd: this.formatDecimal(entry.totalUsd),
        displayUsd: this.formatDecimal(displayUsd),
        movimientos: Number(entry.movimientos || 0),
      };
    });
    const totalGeneralUsd = this.resolveGeneralCloseUsdTotal(breakdown, tasaCierreUsd);
    const devolucionesVed = devolucionesAggregate._sum?.TotalMercancia ?? ZERO;
    const devolucionesUsd = tasaCierreUsd.greaterThan(ZERO) ? devolucionesVed.div(tasaCierreUsd) : ZERO;
    const totalVentaNetaUsd = Prisma.Decimal.max(totalGeneralUsd.minus(devolucionesUsd), ZERO).toDecimalPlaces(2);
    const gananciaNetaUsd = totalVentaNetaUsd.minus(inventoryCost.total).toDecimalPlaces(2);

    const summary = {
      sucursalNombre: await this.resolveCurrentSucursalNombre(),
      fecha: this.formatReportDate(normalizedFecha),
      totalCajas: syncedItems.length,
      cajasCerradas: syncedItems.filter((item) => Number(item.Status ?? 0) === 2).length,
      cajasConVentas: syncedItems.filter((item) => Number(item.Status ?? 0) === 1).length,
      cajasSoloApertura: syncedItems.filter((item) => Number(item.Status ?? 0) === 0).length,
      totalFacturas: Number(salesAggregate._count?._all || 0),
      totalMercanciaVed: this.formatDecimal(salesAggregate._sum?.TotalMercancia),
      totalDescuentoVed: this.formatDecimal(salesAggregate._sum?.TotalDescuento),
      totalImpuestoVed: this.formatDecimal(salesAggregate._sum?.TotalImpuesto),
      totalGeneralVed: this.formatDecimal(salesAggregate._sum?.TotalPago),
      totalGeneralUsd: this.formatDecimal(totalGeneralUsd),
      totalDevoluciones: Number(devolucionesAggregate._count?._all || 0),
      totalDevolucionesVed: this.formatDecimal(devolucionesAggregate._sum?.TotalMercancia),
      totalDevolucionesUsd: this.formatDecimal(devolucionesUsd),
      totalVentaNetaUsd: this.formatDecimal(totalVentaNetaUsd),
      costoMercanciaUsd: this.formatDecimal(inventoryCost.total),
      gananciaNetaUsd: this.formatDecimal(gananciaNetaUsd),
      cajas: syncedItems.map((item) => ({
        serie: String(item.Serie || "").trim(),
        numeroCaja: Number(item.Numero || 0),
        status: toCajaView(item).statusNombre,
        facturaInicial: String(item.FacturaInicial?.toString() ?? "0"),
        ultimaFactura: String(item.FacturaFinal?.toString() ?? "0"),
        horaApertura: this.formatTimeValue(item.HoraApertura),
        horaCierre: this.formatTimeValue(item.HoraCierre),
      })),
      breakdown,
      costosArticulos: inventoryCost.detalles.map((item) => ({
        articulo: item.articulo,
        costoUnitarioUsd: this.formatDecimal(item.costoUnitario),
        cantidad: this.formatDecimal(item.cantidad),
        costoTotalUsd: this.formatDecimal(item.costoTotal),
        tuvoDevolucion: item.tuvoDevolucion,
        cantidadDevuelta: this.formatDecimal(item.cantidadDevuelta),
      })),
      generatedAt: this.formatReportTimestamp(new Date()),
    };

    const pdf = buildCashRegisterGeneralCloseReportPdf(summary);
    return {
      fileName: `cierre-general-${this.slugifyForFileName(summary.sucursalNombre)}-${this.formatFileDate(normalizedFecha)}.pdf`,
      generatedAt: summary.generatedAt,
      summary,
      pdfBase64: pdf.toString("base64"),
    };
  }

  private async buildCloseReportPayload(item: CajaSessionRecord) {
    const { start, end } = this.getDayRange(item.Fecha);
    const salesAggregate = await this.prisma.ventas.aggregate({
      where: {
        Serie: item.Serie,
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        TotalMercancia: true,
        TotalDescuento: true,
        TotalImpuesto: true,
        TotalPago: true,
        TotalDolares: true,
      },
    });

    const devolucionesAggregate = await this.prisma.devVentas.aggregate({
      where: {
        Serie: item.Serie,
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        TotalMercancia: true,
      },
    });
    const tasaCierreUsd = await this.resolveGeneralCloseUsdRate(start, end);
    const devolucionesVed = devolucionesAggregate._sum?.TotalMercancia ?? ZERO;
    const devolucionesUsd = tasaCierreUsd.greaterThan(ZERO) ? devolucionesVed.div(tasaCierreUsd) : ZERO;
    const ventaBrutaUsd = salesAggregate._sum?.TotalDolares ?? ZERO;
    const totalVentaNetaUsd = Prisma.Decimal.max(ventaBrutaUsd.minus(devolucionesUsd), ZERO).toDecimalPlaces(2);

    const parsedSummary = parseCashRegisterPaymentSummary(item.ReporteZTexto);
    const fallbackBreakdown = parsedSummary.payments.length
      ? []
      : await this.buildFallbackCloseBreakdown(item.Serie, start, end);
    const breakdown = (parsedSummary.payments.length
      ? parsedSummary.payments.map((entry) => ({
          label: entry.label,
          totalVed: this.formatDecimal(entry.totalVed),
          totalUsd: this.formatDecimal(entry.totalUsd),
          movimientos: Number(entry.movimientos || 0),
        }))
      : fallbackBreakdown)
      .sort((left, right) => String(left.label || "").localeCompare(String(right.label || ""), "es"));

    const summary = {
      sucursalNombre: await this.resolveCurrentSucursalNombre(),
      serie: item.Serie,
      numeroCaja: Number(item.Numero || 0),
      fecha: this.formatReportDate(item.Fecha),
      horaApertura: this.formatTimeValue(item.HoraApertura),
      horaCierre: this.formatTimeValue(item.HoraCierre),
      status: toCajaView(item).statusNombre,
      totalFacturas: Number(salesAggregate._count?._all || 0),
      totalMercanciaVed: this.formatDecimal(salesAggregate._sum?.TotalMercancia),
      totalDescuentoVed: this.formatDecimal(salesAggregate._sum?.TotalDescuento),
      totalImpuestoVed: this.formatDecimal(salesAggregate._sum?.TotalImpuesto),
      totalGeneralVed: this.formatDecimal(salesAggregate._sum?.TotalPago),
      totalGeneralUsd: this.formatDecimal(salesAggregate._sum?.TotalDolares),
      totalDevoluciones: Number(devolucionesAggregate._count?._all || 0),
      totalDevolucionesVed: this.formatDecimal(devolucionesAggregate._sum?.TotalMercancia),
      totalDevolucionesUsd: this.formatDecimal(devolucionesUsd),
      totalVentaNetaUsd: this.formatDecimal(totalVentaNetaUsd),
      breakdown,
      generatedAt: this.formatReportTimestamp(new Date()),
    };
    const pdf = buildCashRegisterCloseReportPdf(summary);
    const fileName = `cierre-caja-${String(item.Serie || "CAJA").trim().toLowerCase()}-${this.formatFileDate(item.Fecha)}.pdf`;

    return {
      fileName,
      generatedAt: summary.generatedAt,
      summary,
      pdfBase64: pdf.toString("base64"),
    };
  }

  private async buildFallbackCloseBreakdown(serie: string, start: Date, end: Date) {
    const grouped = await this.prisma.ventas.groupBy({
      by: ["FormaPago"],
      where: {
        Serie: serie,
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        TotalPago: true,
        TotalDolares: true,
      },
    });

    if (!grouped.length) {
      return [];
    }

    const paymentCodes = grouped.map((item) => Number(item.FormaPago || 0));
    const paymentCatalog = await this.prisma.formaPago.findMany({
      where: {
        Codigo: {
          in: paymentCodes,
        },
      },
    });
    const paymentNameMap = new Map<number, FormaPago>(paymentCatalog.map((item) => [item.Codigo, item]));

    return grouped.map((item) => {
      const payment = paymentNameMap.get(Number(item.FormaPago || 0));
      return {
        label: String(payment?.Nombre || `FORMA ${String(item.FormaPago || 0)}`).trim() || `FORMA ${String(item.FormaPago || 0)}`,
        totalVed: this.formatDecimal(item._sum?.TotalPago),
        totalUsd: this.formatDecimal(item._sum?.TotalDolares),
        movimientos: Number(item._count?._all || 0),
      };
    });
  }

  private async buildFallbackGeneralCloseBreakdown(series: string[], start: Date, end: Date) {
    const normalizedSeries = [...new Set((Array.isArray(series) ? series : []).map((item) => String(item || "").trim()).filter(Boolean))];
    if (!normalizedSeries.length) {
      return [];
    }

    const grouped = await this.prisma.ventas.groupBy({
      by: ["FormaPago"],
      where: {
        Serie: {
          in: normalizedSeries,
        },
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        TotalPago: true,
        TotalDolares: true,
      },
    });

    if (!grouped.length) {
      return [];
    }

    const paymentCodes = grouped.map((item) => Number(item.FormaPago || 0));
    const paymentCatalog = await this.prisma.formaPago.findMany({
      where: {
        Codigo: {
          in: paymentCodes,
        },
      },
    });
    const paymentNameMap = new Map<number, FormaPago>(paymentCatalog.map((item) => [item.Codigo, item]));

    return grouped.map((item) => {
      const payment = paymentNameMap.get(Number(item.FormaPago || 0));
      return {
        label: String(payment?.Nombre || `FORMA ${String(item.FormaPago || 0)}`).trim() || `FORMA ${String(item.FormaPago || 0)}`,
        totalVed: this.formatDecimal(item._sum?.TotalPago),
        totalUsd: this.formatDecimal(item._sum?.TotalDolares),
        movimientos: Number(item._count?._all || 0),
      };
    });
  }

  private async resolveGeneralCloseUsdRate(start: Date, end: Date) {
    const latestSaleWithRate = await this.prisma.ventas.findFirst({
      where: {
        Fecha: {
          gte: start,
          lt: end,
        },
        TasaCambio: {
          not: null,
          gt: ZERO,
        },
      },
      orderBy: [{ Fecha: "desc" }, { NumeroFactura: "desc" }],
      select: {
        TasaCambio: true,
      },
    });

    if (!latestSaleWithRate?.TasaCambio || latestSaleWithRate.TasaCambio.lessThanOrEqualTo(ZERO)) {
      return ZERO;
    }

    return latestSaleWithRate.TasaCambio.toDecimalPlaces(2);
  }

  private resolveGeneralCloseUsdTotal(
    breakdown: Array<{ totalVed: string; totalUsd: string }>,
    tasaCambioCierre: Prisma.Decimal,
  ) {
    return (Array.isArray(breakdown) ? breakdown : []).reduce((sum, entry) => {
      const totalUsd = new Prisma.Decimal(entry?.totalUsd || 0);
      if (totalUsd.greaterThan(ZERO)) {
        return sum.plus(totalUsd);
      }

      const totalVed = new Prisma.Decimal(entry?.totalVed || 0);
      if (totalVed.greaterThan(ZERO) && tasaCambioCierre.greaterThan(ZERO)) {
        return sum.plus(totalVed.div(tasaCambioCierre));
      }

      return sum;
    }, ZERO).toDecimalPlaces(2);
  }

  private async calculateGeneralCloseInventoryCost(start: Date, end: Date) {
    const [soldItems, returnedItems] = await Promise.all([
      this.prisma.movVentas.findMany({
        where: {
          venta: {
            is: {
              Fecha: {
                gte: start,
                lt: end,
              },
            },
          },
        },
        select: {
          CodigoBarra: true,
          Cantidad: true,
          CantidadDevuelta: true,
          inventarioRef: {
            select: {
              Referencia: true,
              CostoDolar: true,
            },
          },
        },
      }),
      // Devoluciones registradas HOY, sin importar que dia se vendio originalmente el
      // articulo: si no se incluyen aqui, un articulo devuelto de una factura de otro dia
      // nunca aparece en esta lista y la devolucion queda invisible para quien revisa.
      this.prisma.movDevVentas.findMany({
        where: {
          devVenta: {
            is: {
              Fecha: {
                gte: start,
                lt: end,
              },
            },
          },
        },
        select: {
          CodigoBarra: true,
          Cantidad: true,
          inventarioRef: {
            select: {
              Referencia: true,
              CostoDolar: true,
            },
          },
        },
      }),
    ]);

    const detailsMap = new Map<string, {
      articulo: string;
      cantidad: Prisma.Decimal;
      costoUnitario: Prisma.Decimal;
      costoTotal: Prisma.Decimal;
      cantidadDevuelta: Prisma.Decimal;
      tuvoDevolucion: boolean;
    }>();

    const resolveEntry = (articulo: string, costoUnitario: Prisma.Decimal) => {
      const existing = detailsMap.get(articulo);
      if (existing) {
        return existing;
      }

      const created = {
        articulo,
        cantidad: ZERO,
        costoUnitario,
        costoTotal: ZERO,
        cantidadDevuelta: ZERO,
        tuvoDevolucion: false,
      };
      detailsMap.set(articulo, created);
      return created;
    };

    for (const item of soldItems) {
      const costoUnitario = this.resolveGeneralCloseInventoryUnitCost(item.inventarioRef);
      // Se descuenta lo ya devuelto (historico de esa linea): ese costo no debe contar
      // como mercancia vendida porque el articulo volvio a existencia.
      const cantidad = Prisma.Decimal.max((item.Cantidad ?? ZERO).minus(item.CantidadDevuelta ?? ZERO), ZERO);
      if (costoUnitario.lessThanOrEqualTo(ZERO) || cantidad.lessThanOrEqualTo(ZERO)) {
        continue;
      }

      const articulo = String(item.inventarioRef?.Referencia || item.CodigoBarra || "").trim() || "SIN CODIGO";
      const entry = resolveEntry(articulo, costoUnitario.toDecimalPlaces(2));
      const costoTotal = costoUnitario.mul(cantidad).toDecimalPlaces(2);
      entry.cantidad = entry.cantidad.plus(cantidad).toDecimalPlaces(2);
      entry.costoTotal = entry.costoTotal.plus(costoTotal).toDecimalPlaces(2);
    }

    for (const item of returnedItems) {
      const cantidadDevuelta = item.Cantidad ?? ZERO;
      if (cantidadDevuelta.lessThanOrEqualTo(ZERO)) {
        continue;
      }

      const costoUnitario = this.resolveGeneralCloseInventoryUnitCost(item.inventarioRef);
      const articulo = String(item.inventarioRef?.Referencia || item.CodigoBarra || "").trim() || "SIN CODIGO";
      const entry = resolveEntry(articulo, costoUnitario.toDecimalPlaces(2));
      entry.cantidadDevuelta = entry.cantidadDevuelta.plus(cantidadDevuelta).toDecimalPlaces(2);
      entry.tuvoDevolucion = true;
    }

    const detalles = [...detailsMap.values()]
      .filter((item) => item.cantidad.greaterThan(ZERO) || item.tuvoDevolucion)
      .sort((left, right) => left.articulo.localeCompare(right.articulo, "es"));
    const total = detalles.reduce((sum, item) => sum.plus(item.costoTotal), ZERO).toDecimalPlaces(2);

    return {
      total,
      detalles,
    };
  }

  private resolveGeneralCloseInventoryUnitCost(
    inventory:
      | {
          CostoDolar: Prisma.Decimal;
        }
      | null
      | undefined,
  ) {
    if (!inventory) {
      return ZERO;
    }

    if (inventory.CostoDolar.greaterThan(ZERO)) {
      return inventory.CostoDolar;
    }

    return ZERO;
  }

  private formatDecimal(value: Prisma.Decimal | string | number | null | undefined) {
    if (value === null || value === undefined) {
      return "0.00";
    }

    const normalized = value instanceof Prisma.Decimal
      ? value.toDecimalPlaces(2)
      : new Prisma.Decimal(value || 0).toDecimalPlaces(2);
    return normalized.toString();
  }

  private formatReportDate(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${day}/${month}/${year}`;
  }

  private slugifyForFileName(value: string) {
    return (
      String(value || "")
        .normalize("NFD")
        .replace(/\p{Mn}/gu, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "sucursal"
    );
  }

  private formatFileDate(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private formatTimeValue(value: Date | null | undefined) {
    if (!value) {
      return "-";
    }
    return this.formatTime(value);
  }

  private formatReportTimestamp(value: Date) {
    return `${this.formatReportDate(value)} ${this.formatTime(value)}`;
  }

  private buildWhere(findCajasDto: FindCajasDto): Prisma.DiarioCajaWhereInput {    const conditions: Prisma.DiarioCajaWhereInput[] = [];
    const search = String(findCajasDto.buscar || "").trim();

    if (typeof findCajasDto.status === "number") {
      conditions.push({ Status: findCajasDto.status });
    }

    if (search) {
      const parsedNumber = Number.parseInt(search, 10);
      conditions.push({
        OR: [
          { Serie: { contains: search, mode: "insensitive" } },
          Number.isInteger(parsedNumber) ? { Numero: parsedNumber } : {},
          Number.isInteger(parsedNumber) ? { FacturaInicial: BigInt(parsedNumber) } : {},
          Number.isInteger(parsedNumber) ? { FacturaFinal: BigInt(parsedNumber) } : {},
        ],
      });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  private async findCajaSessionOrThrow(serie: string, fecha: string) {
    const normalizedSerie = this.normalizeSerie(serie);
    const normalizedFecha = this.parseDateKey(fecha);

    const caja = await this.prisma.diarioCaja.findUnique({
      where: {
        Serie_Fecha: {
          Serie: normalizedSerie,
          Fecha: normalizedFecha,
        },
      },
      include: { caja: true },
    });

    if (!caja) {
      throw new NotFoundException("La caja no existe.");
    }

    return caja;
  }

  private normalizeInput(payload: CreateCajaDto | UpdateCajaDto): NormalizedCajaInput {
    const serie = this.normalizeSerie(payload.serie);
    const fecha = this.startOfDay(payload.fecha);
    const numeroCaja = this.resolveNumeroCaja(payload.numeroCaja);
    const ultimaFactura = this.parseBigInt(payload.ultimaFactura, 0n);
    const facturaInicial = this.parseBigInt(payload.facturaInicial, ultimaFactura + 1n);
    const horaApertura = this.normalizeTime(payload.horaApertura) ?? this.formatTime(new Date());
    const horaCierre = this.normalizeTime(payload.horaCierre);

    return {
      serie,
      fecha,
      numeroCaja,
      facturaInicial,
      ultimaFactura,
      horaApertura,
      horaCierre,
      nombreImpresora: this.normalizePrinterName(payload.nombreImpresora),
    };
  }

  private async ensureCajaConfig(
    tx: CajaTransactionClient,
    normalized: NormalizedCajaInput,
    currentCaja?: Cajas,
  ) {
    const existing = currentCaja ?? await tx.cajas.findUnique({
      where: { Serie: normalized.serie },
    });

    const nextUltimaFactura = normalized.ultimaFactura > 0n
      ? normalized.ultimaFactura
      : existing?.UltimaFactura ?? 0n;

    if (existing) {
      await tx.cajas.update({
        where: { Serie: normalized.serie },
        data: {
          Numero: normalized.numeroCaja,
          UltimaFactura: nextUltimaFactura,
          NombreImpresora:
            normalized.nombreImpresora
            ?? existing.NombreImpresora
            ?? "NO APLICA",
        },
      });
      await this.mirrorSyncService.enqueueCajaUpsertTx(tx, normalized.serie);
      return;
    }

    const template = await tx.cajas.findFirst({
      orderBy: [{ Numero: "asc" }, { Serie: "asc" }],
    });

    await tx.cajas.create({
      data: {
        Serie: normalized.serie,
        Numero: normalized.numeroCaja,
        FondoCaja: template?.FondoCaja ?? ZERO,
        TipoListaPrecio: template?.TipoListaPrecio ?? 1,
        TipoVenta: template?.TipoVenta ?? 0,
        TipoReporte: template?.TipoReporte ?? 0,
        UltimaFactura: nextUltimaFactura,
        UltimaDevolucion: template?.UltimaDevolucion ?? 0n,
        PermiteDescuento: template?.PermiteDescuento ?? 1,
        PermiteFacturasExentas: template?.PermiteFacturasExentas ?? 1,
        PermiteAlternarListas: template?.PermiteAlternarListas ?? 0,
        CambiarPrecios: template?.CambiarPrecios ?? 0,
        RequerirAutorizacion: template?.RequerirAutorizacion ?? 0,
        IdImpresoraFiscal: template?.IdImpresoraFiscal ?? 0,
        NombreImpresora: normalized.nombreImpresora ?? template?.NombreImpresora ?? "NO APLICA",
        NumeroCopias: template?.NumeroCopias ?? 1,
        IncluirIGTF: template?.IncluirIGTF ?? false,
      },
    });
    await this.mirrorSyncService.enqueueCajaUpsertTx(tx, normalized.serie);
  }

  // Nombre real de la sucursal donde corre esta instancia, para que los reportes de caja
  // muestren la tienda correcta en vez de un nombre fijo. Deriva el codigo desde
  // DATABASE_URL (mismo patron que getCurrentInstanceContext en dev-returns.service.ts) y
  // busca el nombre real en SUCURSALES; si no encuentra fila, cae a un rotulo generico en
  // vez de fallar el reporte.
  private async resolveCurrentSucursalNombre() {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    const databaseName = databaseUrl.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "";
    const storeMatch = databaseName.match(/rocky_tienda_(\d+)/i);
    const warehouseMatch = databaseName.match(/rocky_bodega_(\d+)/i);

    let codigo = "ORIGEN";
    let fallback = "ROCKY MAXX";
    if (storeMatch) {
      codigo = storeMatch[1].padStart(3, "0");
      fallback = `Tienda ${codigo}`;
    } else if (warehouseMatch) {
      codigo = `B${warehouseMatch[1].padStart(3, "0")}`;
      fallback = `Bodega ${warehouseMatch[1].padStart(3, "0")}`;
    }

    const sucursal = await this.prisma.sucursales.findUnique({ where: { Codigo: codigo } });
    return sucursal?.Nombre?.trim() || fallback;
  }

  private normalizeSerie(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar la serie de la caja.");
    }

    return normalized;
  }

  private resolveNumeroCaja(value: number | undefined) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException("El numero de caja no es valido.");
    }

    return parsed;
  }

  private parseBigInt(value: string | undefined, fallback: bigint) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return fallback;
    }

    try {
      const parsed = BigInt(raw);
      if (parsed < 0n) {
        throw new Error("negative");
      }

      return parsed;
    } catch {
      throw new BadRequestException("El numero de factura no es valido.");
    }
  }

  private normalizePrinterName(value: string | undefined) {
    const normalized = String(value || "").trim();
    return normalized || undefined;
  }
  private parseDateKey(value: string) {
    const normalized = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new BadRequestException("La fecha de la caja no es valida.");
    }

    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("La fecha de la caja no es valida.");
    }

    return this.startOfDay(parsed);
  }

  private normalizeTime(value: string | undefined) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return undefined;
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
      throw new BadRequestException("La hora de caja no es valida.");
    }

    return normalized;
  }

  private combineDateAndTime(date: Date, time: string) {
    const [hours, minutes] = time.split(":").map((item) => Number.parseInt(item, 10));
    const combined = new Date(date.getTime());
    combined.setHours(hours, minutes, 0, 0);
    return combined;
  }

  private startOfDay(date: Date) {
    const normalized = new Date(date.getTime());
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  private formatTime(value: Date) {
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  private async syncCajaSessionState(
    item: Awaited<ReturnType<CajasService["findCajaSessionOrThrow"]>>,
  ) {
    const derivedState = await this.resolveDerivedCajaState(
      this.prisma,
      item.Serie,
      item.Fecha,
      item.Status,
      BigInt(item.FacturaFinal?.toString() ?? "0"),
    );

    const currentFacturaFinal = BigInt(item.FacturaFinal?.toString() ?? "0");
    if (item.Status === derivedState.status && currentFacturaFinal === derivedState.ultimaFactura) {
      return item;
    }

    return this.prisma.diarioCaja.update({
      where: {
        Serie_Fecha: {
          Serie: item.Serie,
          Fecha: item.Fecha,
        },
      },
      data: {
        Status: derivedState.status,
        FacturaFinal: derivedState.ultimaFactura,
      },
      include: { caja: true },
    });
  }

  private async resolveDerivedCajaState(
    client: PrismaService | CajaTransactionClient,
    serie: string,
    fecha: Date,
    currentStatus: number,
    currentUltimaFactura: bigint,
  ) {
    const { start, end } = this.getDayRange(fecha);
    const salesAggregate = await client.ventas.aggregate({
      where: {
        Serie: serie,
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _count: {
        _all: true,
      },
      _max: {
        NumeroFactura: true,
      },
    });

    const maxNumeroFactura = BigInt(salesAggregate._max.NumeroFactura?.toString() ?? "0");
    const derivedUltimaFactura = maxNumeroFactura > currentUltimaFactura
      ? maxNumeroFactura
      : currentUltimaFactura;

    if (currentStatus === 2) {
      return {
        status: 2,
        ultimaFactura: derivedUltimaFactura,
      };
    }

    return {
      status: salesAggregate._count._all > 0 ? 1 : 0,
      ultimaFactura: derivedUltimaFactura,
    };
  }

  private validateFacturaRange(facturaInicial: bigint, status: number, ultimaFactura: bigint) {
    if (status !== 0 && ultimaFactura < facturaInicial) {
      throw new BadRequestException(
        "La ultima factura no puede ser menor que la factura inicial cuando la caja ya tiene ventas o esta cerrada.",
      );
    }
  }

  private getDayRange(date: Date) {
    const start = this.startOfDay(date);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
}



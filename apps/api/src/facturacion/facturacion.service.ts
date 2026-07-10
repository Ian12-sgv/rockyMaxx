import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type DiarioCaja, type Inventario } from "@prisma/client";
import { ConfigService } from "@nestjs/config";

import {
  createEmptyCashRegisterPaymentSummary,
  mergeCashRegisterPaymentSummary,
  parseCashRegisterPaymentSummary,
  serializeCashRegisterPaymentSummary,
} from "../cajas/caja-close-report.util";
import { findContingenciaReportFormatById, getContingenciaReportFormats } from "../impresoras/contingencia-report-formats.util";
import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { UserView } from "../users/user-view.util";
import { CreateFacturacionSaleDto, FacturacionPaymentRowDto, FacturacionSaleItemDto } from "./dto/create-facturacion-sale.dto";

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const HUNDRED = new Prisma.Decimal(100);
const DEFAULT_FACTURACION_COMPANY_NAME = "SENIAT";
const DEFAULT_FACTURACION_COMPANY_DESCRIPTION = "Venta de ropa intima y deportiva para dama y caballeros, niÃƒÂ±os y niÃƒÂ±as y otro tipo de mercancia.";
const DEFAULT_FACTURACION_COMPANY_TAX_LABEL = "RIF";
const DEFAULT_FACTURACION_COMPANY_TAX_ID = "J-308460281";
const DEFAULT_FACTURACION_STORE_CODE = "ORIGEN";
const FACTURACION_STORE_TAX_ID_BY_CODE: Record<string, string> = {
  "001": "J508243501",
  "002": "J507479307",
  "003": "J507479307",
  "004": "J508243501",
  "005": "J50759282-2",
  "006": "J506873850",
  ORIGEN: "",
  B002: "",
};
const FACTURACION_STORE_ADDRESS_BY_CODE: Record<string, string> = {
  "001": "Calle 97 entre Avenidas 14A y 15, Prolongacion de la Av. 15 Las Delicias, C.C. Law Center PB Local 19, Maracaibo, Zulia Z.P. 4001",
  "002": "Av. Libertador, calle 100 C.C. Plaza Lago Nivel Planta Baja, Local 48 Sector Casco Central, Maracaibo, Zulia Z.P. 4001",
  "003": "Av. Libertador, calle 100 C.C. Plaza Lago Nivel Planta Baja, Local 48 Sector Casco Central, Maracaibo, Zulia Z.P. 4001",
  "004": "Calle 97 entre Avenidas 14A y 15, Prolongacion de la Av. 15 Las Delicias, C.C. Law Center PB Local 19, Maracaibo, Zulia Z.P. 4001",
  "005": "Av 20 entre calles 29 y 30 local nro S/N sector Centro Barquisimeto, Lara zona postal 3001",
  "006": "Av 26 entre calle 31 y 32, Edif. Anyul, piso planta baja, local N 6, Centro Barquisimeto, Lara zona postal 3001",
  ORIGEN: "",
  B002: "",
};

type FacturacionTransactionClient = Prisma.TransactionClient;

type ActiveCajaSession = DiarioCaja & {
  caja: {
    Serie: string;
    Numero: number;
    TipoVenta: number;
    UltimaFactura: bigint;
    NombreImpresora: string | null;
    NumeroCopias: number | null;
  } | null;
};

type NormalizedSaleItem = {
  item: number;
  codigoBarra: string;
  priceList: "detal" | "mayor" | "afiliado";
  cantidad: Prisma.Decimal;
  precio: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  descuentoPorcentaje: Prisma.Decimal;
};

type NormalizedPaymentRow = {
  item: number;
  formaPago: string;
  monto: Prisma.Decimal;
};

type PaymentCatalogRow = {
  Codigo: number;
  Nombre: string | null;
  Status: number | null;
};

type CompanyPrintProfile = {
  companyName: string;
  companyDescription: string;
  companyAddress: string;
  companyTaxIdLabel: string;
  companyTaxId: string;
};

@Injectable()
export class FacturacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async createSale(payload: CreateFacturacionSaleDto, user: UserView) {
    const usuario = String(user?.codUsuario || "").trim();
    if (!usuario) {
      throw new BadRequestException("No se pudo identificar el usuario autenticado.");
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const cajaActiva = await this.findActiveCajaSession(tx);
        const cliente = await this.resolveCliente(tx, payload.clienteCodigo);
        const vendedor = await this.resolveTrabajador(tx, payload.vendedorCedula);
        const activeTax = await this.findActiveTax(tx);
        const normalizedItems = this.normalizeSaleItems(payload.items);
        const normalizedPayments = this.normalizePaymentRows(payload.pagos);

        const inventoryRecords = await tx.inventario.findMany({
          where: {
            CodigoBarra: {
              in: normalizedItems.map((item) => item.codigoBarra),
            },
          },
        });

        const inventoryByCode = new Map(
          inventoryRecords.map((item) => [this.normalizeCode(item.CodigoBarra), item]),
        );

        for (const line of normalizedItems) {
          if (!inventoryByCode.has(line.codigoBarra)) {
            throw new NotFoundException(`El articulo ${line.codigoBarra} ya no existe en inventario.`);
          }
        }

        this.ensureInventoryAvailability(inventoryByCode, normalizedItems);
        this.ensureInventoryHasPrice(inventoryByCode, normalizedItems);

        const discountOverride = this.resolveDiscountOverride(payload);
        const lineDiscountMonto = normalizedItems.reduce((sum, item) => {
          return sum.plus(item.subtotal.mul(item.descuentoPorcentaje).div(HUNDRED));
        }, ZERO);
        const totalMercancia = normalizedItems.reduce((sum, item) => sum.plus(item.subtotal), ZERO).toDecimalPlaces(2);
        const totalDescuento = discountOverride.active
          ? totalMercancia.mul(discountOverride.percent).div(HUNDRED).toDecimalPlaces(2)
          : lineDiscountMonto.toDecimalPlaces(2);
        const subtotal = Prisma.Decimal.max(totalMercancia.minus(totalDescuento), ZERO).toDecimalPlaces(2);
        const impuestoPorcentaje = ZERO;
        const totalImpuesto = ZERO;
        const totalVenta = subtotal;
        const contingenciaActiva = Boolean(payload.emisionContingencia);
        const tasaCambioDetal = this.parseDecimalInput(payload.tasaCambio, "La tasa de cambio detal no es valida.", {
          allowEmpty: true,
          defaultValue: ZERO,
        });
        const tasaCambioMayor = this.parseDecimalInput(payload.tasaCambioMayor, "La tasa de cambio mayor no es valida.", {
          allowEmpty: true,
          defaultValue: ZERO,
        });
        const tasaCambioVenta = this.resolveSaleUsdRate(normalizedItems, tasaCambioDetal, tasaCambioMayor);
        const totalDolares = tasaCambioVenta.greaterThan(ZERO)
          ? totalVenta.div(tasaCambioVenta).toDecimalPlaces(2)
          : ZERO;

        const paymentCatalog = await tx.formaPago.findMany({
          where: {
            Status: {
              not: 0,
            },
          },
          orderBy: {
            Codigo: "asc",
          },
        });

        const paymentSummary = this.validatePayments(
          normalizedPayments,
          paymentCatalog,
          totalVenta,
          tasaCambioVenta,
        );
        const paymentBreakdown = this.buildCashRegisterPaymentBreakdown(
          normalizedPayments,
          paymentCatalog,
          tasaCambioVenta,
        );
        const currentCashSummary = cajaActiva.ReporteZTexto
          ? parseCashRegisterPaymentSummary(cajaActiva.ReporteZTexto)
          : createEmptyCashRegisterPaymentSummary();
        const updatedCashSummary = mergeCashRegisterPaymentSummary(
          currentCashSummary,
          paymentBreakdown,
        );

        const saleDate = this.buildSaleDateTime(cajaActiva.Fecha);
        const numeroFactura = await this.resolveNextInvoiceNumber(tx, cajaActiva);
        const totalCosto = normalizedItems.reduce((sum, item) => {
          const inventory = inventoryByCode.get(item.codigoBarra);
          const unitCost = this.resolveInventoryCost(inventory);
          return sum.plus(unitCost.mul(item.cantidad));
        }, ZERO).toDecimalPlaces(2);
        const headerPaymentCode = this.resolveHeaderPaymentCode(paymentSummary.paymentCodes, paymentCatalog);
        const printerConfig = await this.resolvePrinterConfigurationForSale(
          tx,
          contingenciaActiva,
          cajaActiva.caja?.NombreImpresora ?? "",
        );
        const companyProfile = await this.resolveCompanyPrintProfile(tx);

        await tx.ventas.create({
          data: {
            NumeroFactura: numeroFactura,
            Serie: cajaActiva.Serie,
            Fecha: saleDate,
            Vendedor: vendedor.Cedula,
            Cliente: cliente.Codigo,
            TipoVenta: cajaActiva.caja?.TipoVenta ?? 0,
            FormaPago: headerPaymentCode,
            DiasCredito: 0,
            TotalMercancia: totalMercancia,
            TotalDescuento: totalDescuento,
            TotalImpuesto: totalImpuesto,
            TotalCosto: totalCosto,
            InterContable: 0,
            Usuario: usuario,
            Status: 1,
            NumeroOrden: numeroFactura,
            TotalPago: totalVenta,
            TotalDolares: totalDolares,
            TasaCambio: tasaCambioVenta,
            Estacion: cajaActiva.Serie,
            TotalDolaresE: paymentSummary.totalDolaresE,
            TasaIGTF: ZERO,
            MontoIGTF: ZERO,
            BaseImponibleIGTF: ZERO,
          },
        });

        for (const line of normalizedItems) {
          const inventory = inventoryByCode.get(line.codigoBarra);
          const effectiveDiscountPercent = discountOverride.active ? discountOverride.percent : line.descuentoPorcentaje;
          const unitTaxAmount = ZERO;

          await tx.movVentas.create({
            data: {
              NumeroFactura: numeroFactura,
              Serie: cajaActiva.Serie,
              Hora: saleDate,
              TipoLista: this.toLegacyPriceListCode(line.priceList),
              CodigoBarra: inventory?.CodigoBarra ?? line.codigoBarra,
              Precio: line.precio.toDecimalPlaces(2),
              PrecioLista: this.resolveInventoryPriceForList(inventory, line.priceList).toDecimalPlaces(2),
              Costo: this.resolveInventoryCost(inventory).toDecimalPlaces(2),
              Impuesto: unitTaxAmount,
              PorcentajeImpuesto: impuestoPorcentaje.toDecimalPlaces(2),
              Cantidad: line.cantidad,
              CantidadDevuelta: ZERO,
              Item: line.item,
              PorcentajeDescuento: effectiveDiscountPercent.toDecimalPlaces(2),
              PrecioDetal: (inventory?.PrecioDetal ?? ZERO).toDecimalPlaces(2),
              Regla: "",
              IDRegla: 0,
            },
          });
        }

        await this.updateInventoryExistence(tx, inventoryByCode, normalizedItems, saleDate);
        await tx.diarioCaja.update({
          where: {
            Serie_Fecha: {
              Serie: cajaActiva.Serie,
              Fecha: cajaActiva.Fecha,
            },
          },
          data: {
            FacturaFinal: numeroFactura,
            Status: 1,
            Acumulado: (cajaActiva.Acumulado ?? ZERO).plus(totalVenta).toDecimalPlaces(2),
            PorcentajeImpuesto: impuestoPorcentaje.toDecimalPlaces(2),
            ReporteZTexto: serializeCashRegisterPaymentSummary(updatedCashSummary),
          },
        });
        await tx.cajas.update({
          where: {
            Serie: cajaActiva.Serie,
          },
          data: {
            UltimaFactura: numeroFactura,
          },
        });

        await this.mirrorSyncService.enqueueInventorySnapshotsTx(
          tx,
          normalizedItems.map((item) => item.codigoBarra),
        );
        await this.mirrorSyncService.enqueueVentaUpsertTx(
          tx,
          numeroFactura,
          cajaActiva.Serie,
        );

        return {
          numeroFactura: numeroFactura.toString(),
          serie: cajaActiva.Serie,
          fecha: saleDate,
          totalMercancia: totalMercancia.toString(),
          totalDescuento: totalDescuento.toString(),
          totalImpuesto: totalImpuesto.toString(),
          totalVenta: totalVenta.toString(),
          totalDolares: totalDolares.toString(),
          tasaCambio: tasaCambioVenta.toString(),
          cliente: cliente.Codigo,
          clienteNombre: cliente.Nombre,
          clienteTelefono: cliente.Telefono ?? "",
          clienteDireccion: cliente.Direccion ?? "",
          companyName: companyProfile.companyName,
          companyDescription: companyProfile.companyDescription,
          companyAddress: companyProfile.companyAddress,
          companyTaxIdLabel: companyProfile.companyTaxIdLabel,
          companyTaxId: companyProfile.companyTaxId,
          vendedor: vendedor.Cedula,
          vendedorNombre: vendedor.Nombre,
          numeroCaja: cajaActiva.caja?.Numero ?? 0,
          usuario,
          nombreUsuario: user?.nombreUsuario || user?.codUsuario || usuario,
          nombreImpresora: printerConfig.printerName,
          numeroCopias: cajaActiva.caja?.NumeroCopias ?? 1,
          emisionContingencia: Boolean(payload.emisionContingencia),
          formatoContingenciaId: printerConfig.formatoContingenciaId,
          formatoContingenciaArchivo: printerConfig.formatoContingenciaArchivo,
          items: normalizedItems.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    return result;
  }

  private async findActiveCajaSession(tx: FacturacionTransactionClient): Promise<ActiveCajaSession> {
    const sessions = await tx.diarioCaja.findMany({
      where: {
        Status: {
          in: [0, 1],
        },
      },
      include: {
        caja: true,
      },
      orderBy: [{ Fecha: "desc" }, { Numero: "desc" }, { Serie: "asc" }],
      take: 1,
    });

    if (!sessions.length) {
      throw new ConflictException("Debes abrir una caja antes de registrar una venta.");
    }

    return sessions[0] as ActiveCajaSession;
  }

  private async resolveCliente(tx: FacturacionTransactionClient, codigo: string) {
    const normalizedCode = String(codigo || "").trim();
    if (!normalizedCode) {
      throw new BadRequestException("Debes indicar el cliente de la factura.");
    }

    const direct = await tx.clientes.findUnique({
      where: {
        Codigo: normalizedCode,
      },
    });
    if (direct) {
      return direct;
    }

    const search = this.normalizeIdentityComparable(normalizedCode);
    const candidates = await tx.clientes.findMany({
      where: {
        OR: [
          { Codigo: { contains: normalizedCode, mode: "insensitive" } },
          { Nombre: { contains: normalizedCode, mode: "insensitive" } },
        ],
      },
      take: 100,
    });
    const matched = candidates.find((item) => this.normalizeIdentityComparable(item.Codigo) === search);
    if (!matched) {
      throw new NotFoundException(`No se encontro el cliente ${normalizedCode}.`);
    }

    return matched;
  }

  private async resolvePrinterConfigurationForSale(
    tx: FacturacionTransactionClient,
    contingenciaActiva: boolean,
    fallbackPrinterName: string,
  ) {
    const targetStatus = contingenciaActiva ? 1 : 0;
    const rows = await tx.$queryRaw<Array<{ NombreImpresora: string | null; IdProcesoImpresion: string | number | bigint | null }>>`
      SELECT "NombreImpresora", "IdProcesoImpresion"
      FROM "dbo"."IMPRESORAFISCAL"
      WHERE "Status" = ${targetStatus}
      ORDER BY "ID" ASC
      LIMIT 1
    `;

    const configuredPrinterName = String(rows[0]?.NombreImpresora || "").trim();
    const reportFormats = getContingenciaReportFormats();
    const fallbackFormat = reportFormats[0] ?? null;
    const selectedFormat = findContingenciaReportFormatById(rows[0]?.IdProcesoImpresion) ?? fallbackFormat;

    return {
      printerName: configuredPrinterName || String(fallbackPrinterName || "").trim(),
      formatoContingenciaId: selectedFormat?.id ?? 0,
      formatoContingenciaArchivo: selectedFormat?.fileName ?? "",
    };
  }
  private async resolveCompanyPrintProfile(
    tx: FacturacionTransactionClient,
  ): Promise<CompanyPrintProfile> {
    const parametros = await tx.parametros.findFirst({
      orderBy: {
        IDPARAMETROS: "asc",
      },
    });
    const currentStore = this.getCurrentStoreContext();
    const sucursal = await tx.sucursales.findUnique({
      where: {
        Codigo: currentStore.sucursalCodigo,
      },
    }).catch(() => null);

    const parametrosName = this.normalizeOptionalTicketText(parametros?.Nombre);
    const sucursalName = this.normalizeOptionalTicketText(sucursal?.Nombre);
    const shouldUseCommercialFallback = currentStore.isCentralDatabase;
    const rawStoreName = parametrosName
      || (shouldUseCommercialFallback ? null : sucursalName)
      || currentStore.fallbackName
      || DEFAULT_FACTURACION_COMPANY_NAME;
    const fallbackTaxId = this.normalizeOptionalTicketText(parametros?.IDEmpresa)
      || this.normalizeOptionalTicketText(parametros?.Codigo)
      || DEFAULT_FACTURACION_COMPANY_TAX_ID;

    return {
      companyName: this.formatCompanyNameForTicket(rawStoreName),
      companyDescription: DEFAULT_FACTURACION_COMPANY_DESCRIPTION,
      companyAddress: this.resolveCompanyAddressForStore(currentStore.sucursalCodigo),
      companyTaxIdLabel: this.normalizeOptionalTicketText(parametros?.NombreIdFiscal) || DEFAULT_FACTURACION_COMPANY_TAX_LABEL,
      companyTaxId: this.resolveCompanyTaxIdForStore(currentStore.sucursalCodigo, fallbackTaxId),
    };
  }

  private getCurrentStoreContext() {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    const databaseNameMatch = databaseUrl.match(/\/([^/?]+)(\?|$)/);
    const databaseName = String(databaseNameMatch?.[1] || "").trim();
    const storeMatch = databaseName.match(/rocky_tienda_(\d+)/i);
    const warehouseMatch = databaseName.match(/rocky_bodega_(\d+)/i);
    const normalizedDatabaseName = databaseName.toLowerCase();
    const isCentralDatabase = normalizedDatabaseName === "rocky_maxx"
      || normalizedDatabaseName === "rocky_sync_central";

    if (storeMatch) {
      const code = storeMatch[1].padStart(3, "0");
      return {
        databaseName,
        sucursalCodigo: code,
        fallbackName: `Tienda ${code}`,
        isCentralDatabase: false,
      };
    }

    if (warehouseMatch) {
      const code = warehouseMatch[1].padStart(3, "0");
      return {
        databaseName,
        sucursalCodigo: `B${code}`,
        fallbackName: `Bodega ${code}`,
        isCentralDatabase: false,
      };
    }

    return {
      databaseName,
      sucursalCodigo: DEFAULT_FACTURACION_STORE_CODE,
      fallbackName: DEFAULT_FACTURACION_COMPANY_NAME,
      isCentralDatabase,
    };
  }

  private resolveCompanyTaxIdForStore(
    storeCode: string | null | undefined,
    fallbackValue: string,
  ) {
    const normalizedStoreCode = String(storeCode || "").trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(FACTURACION_STORE_TAX_ID_BY_CODE, normalizedStoreCode)) {
      return FACTURACION_STORE_TAX_ID_BY_CODE[normalizedStoreCode] || "";
    }

    return fallbackValue;
  }

  private resolveCompanyAddressForStore(storeCode: string | null | undefined) {
    const normalizedStoreCode = String(storeCode || "").trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(FACTURACION_STORE_ADDRESS_BY_CODE, normalizedStoreCode)) {
      return FACTURACION_STORE_ADDRESS_BY_CODE[normalizedStoreCode] || "";
    }

    return "";
  }

  private formatCompanyNameForTicket(value: string | null | undefined) {    const normalized = this.normalizeOptionalTicketText(value) || DEFAULT_FACTURACION_COMPANY_NAME;
    if (/\b(C\.?\s*A\.?|S\.?\s*A\.?)\b/i.test(normalized)) {
      return normalized;
    }

    return `${normalized}, C.A.`;
  }

  private normalizeOptionalTicketText(value: string | null | undefined) {
    return String(value || "").trim();
  }
  private async resolveTrabajador(tx: FacturacionTransactionClient, cedula: string) {
    const normalizedCedula = String(cedula || "").trim();
    if (!normalizedCedula) {
      throw new BadRequestException("Debes indicar el vendedor de la factura.");
    }

    const direct = await tx.trabajadores.findUnique({
      where: {
        Cedula: normalizedCedula,
      },
    });
    if (direct) {
      return direct;
    }

    const search = this.normalizeIdentityComparable(normalizedCedula);
    const candidates = await tx.trabajadores.findMany({
      where: {
        OR: [
          { Cedula: { contains: normalizedCedula, mode: "insensitive" } },
          { Nombre: { contains: normalizedCedula, mode: "insensitive" } },
        ],
      },
      take: 100,
    });
    const matched = candidates.find((item) => this.normalizeIdentityComparable(item.Cedula) === search);
    if (!matched) {
      throw new NotFoundException(`No se encontro el vendedor ${normalizedCedula}.`);
    }

    return matched;
  }

  private async findActiveTax(tx: FacturacionTransactionClient) {
    return (
      await tx.impuestos.findFirst({
        where: { Status: 1 },
        orderBy: { Codigo: "asc" },
      })
    ) ?? tx.impuestos.findFirst({
      orderBy: { Codigo: "asc" },
    });
  }

  private normalizeSaleItems(items: FacturacionSaleItemDto[]) {
    const rows = Array.isArray(items) ? items : [];
    const normalized = rows
      .map((item, index) => this.normalizeSaleItem(item, index))
      .filter((item): item is NormalizedSaleItem => item !== null);

    if (!normalized.length) {
      throw new BadRequestException("Debes cargar al menos un articulo en la factura.");
    }

    return normalized;
  }

  private normalizeSaleItem(item: FacturacionSaleItemDto, index: number) {
    const codigoBarra = this.normalizeCode(item?.codigoBarra);
    if (!codigoBarra) {
      return null;
    }

    const cantidad = this.parseDecimalInput(item?.cantidad, `La cantidad del articulo ${index + 1} no es valida.`, {
      allowEmpty: true,
      defaultValue: ONE,
    });
    if (cantidad.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException(`La cantidad del articulo ${codigoBarra} debe ser mayor a cero.`);
    }

    const precio = this.parseDecimalInput(item?.precio, `El precio del articulo ${codigoBarra} no es valido.`);
    const subtotal = this.parseDecimalInput(item?.subtotal, `El subtotal del articulo ${codigoBarra} no es valido.`, {
      allowEmpty: true,
      defaultValue: precio.mul(cantidad).toDecimalPlaces(2),
    });
    const descuentoPorcentaje = this.parseDecimalInput(
      item?.descuentoPorcentaje,
      `El descuento del articulo ${codigoBarra} no es valido.`,
      { allowEmpty: true, defaultValue: ZERO },
    );

    return {
      item: index + 1,
      codigoBarra,
      priceList: this.normalizePriceList(item?.priceList),
      cantidad,
      precio: precio.toDecimalPlaces(2),
      subtotal: subtotal.toDecimalPlaces(2),
      descuentoPorcentaje: descuentoPorcentaje.toDecimalPlaces(2),
    };
  }

  private normalizePaymentRows(rows: FacturacionPaymentRowDto[]) {
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((row, index) => this.normalizePaymentRow(row, index))
      .filter((row): row is NormalizedPaymentRow => row !== null);

    if (!normalized.length) {
      throw new BadRequestException("Debes indicar al menos una forma de pago.");
    }

    return normalized;
  }

  private normalizePaymentRow(row: FacturacionPaymentRowDto, index: number) {
    const amount = this.parseDecimalInput(row?.monto, `El monto de la forma de pago ${index + 1} no es valido.`, {
      allowEmpty: true,
      defaultValue: ZERO,
    });
    if (amount.lessThanOrEqualTo(ZERO)) {
      return null;
    }

    const formaPago = String(row?.formaPago || "").trim();
    if (!formaPago) {
      throw new BadRequestException("Cada monto cargado debe tener una forma de pago seleccionada.");
    }

    return {
      item: index + 1,
      formaPago,
      monto: amount,
    };
  }

  private resolveDiscountOverride(payload: CreateFacturacionSaleDto) {
    const authorized = Boolean(payload.overrideDiscountAuthorized);
    const active = Boolean(payload.overrideDiscountActive);
    const percent = this.parseDecimalInput(
      payload.overrideDiscountPercent,
      "El descuento global no es valido.",
      { allowEmpty: true, defaultValue: ZERO },
    );

    return {
      authorized,
      active: authorized && active && percent.greaterThan(ZERO),
      percent: percent.toDecimalPlaces(2),
    };
  }

  private ensureInventoryAvailability(
    inventoryByCode: Map<string, Inventario>,
    items: NormalizedSaleItem[],
  ) {
    const totals = new Map<string, Prisma.Decimal>();
    for (const line of items) {
      const current = totals.get(line.codigoBarra) ?? ZERO;
      totals.set(line.codigoBarra, current.plus(line.cantidad));
    }

    for (const [codigoBarra, requestedQty] of totals.entries()) {
      const inventory = inventoryByCode.get(codigoBarra);
      if (!inventory) {
        throw new NotFoundException(`El articulo ${codigoBarra} no existe en inventario.`);
      }

      if (inventory.Existencia.lessThan(requestedQty)) {
        throw new ConflictException(
          `El articulo ${codigoBarra} no tiene existencia suficiente. Disponible ${inventory.Existencia.toString()}, requerida ${requestedQty.toString()}.`,
        );
      }
    }
  }

  private ensureInventoryHasPrice(
    inventoryByCode: Map<string, Inventario>,
    items: NormalizedSaleItem[],
  ) {
    const uniqueCodes = [...new Set(items.map((item) => item.codigoBarra))];

    for (const codigoBarra of uniqueCodes) {
      const inventory = inventoryByCode.get(codigoBarra);
      if (!inventory) {
        continue;
      }

      const hasConfiguredCosts =
        inventory.CostoInicial.greaterThan(ZERO) ||
        inventory.CostoPromedio.greaterThan(ZERO) ||
        inventory.UltimoCosto.greaterThan(ZERO);

      if (!hasConfiguredCosts) {
        throw new BadRequestException(`Error sin precio. El articulo ${codigoBarra} no tiene costos configurados.`);
      }
    }
  }

  private validatePayments(
    rows: NormalizedPaymentRow[],
    paymentCatalog: PaymentCatalogRow[],
    totalVenta: Prisma.Decimal,
    tasaCambio: Prisma.Decimal,
  ) {
    const paymentCodes: number[] = [];
    const totalDolaresE = rows.reduce((sum, row) => {
      return sum.plus(this.paymentUsesUsdAmount(row.formaPago) ? row.monto : ZERO);
    }, ZERO).toDecimalPlaces(2);
    const abonado = rows.reduce((sum, row) => {
      const resolvedAmount = this.paymentUsesUsdAmount(row.formaPago)
        ? this.convertUsdToBs(row.monto, tasaCambio)
        : row.monto;
      const paymentCode = this.resolvePaymentCode(row.formaPago, paymentCatalog);
      paymentCodes.push(paymentCode);
      return sum.plus(resolvedAmount);
    }, ZERO).toDecimalPlaces(2);

    if (rows.some((row) => this.paymentUsesUsdAmount(row.formaPago)) && tasaCambio.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException("No hay una tasa de cambio vigente para convertir el efectivo en dolares.");
    }

    if (abonado.greaterThan(totalVenta)) {
      throw new BadRequestException("No se puede proceder porque el monto pagado es mayor al total de la venta.");
    }

    if (abonado.lessThan(totalVenta)) {
      throw new BadRequestException("Los pagos cargados aun no cubren el total de la venta.");
    }

    return {
      paymentCodes,
      abonado,
      totalDolaresE,
    };
  }

  private buildCashRegisterPaymentBreakdown(
    rows: NormalizedPaymentRow[],
    paymentCatalog: PaymentCatalogRow[],
    tasaCambio: Prisma.Decimal,
  ) {
    return rows.map((row) => {
      const paymentCode = this.resolvePaymentCode(row.formaPago, paymentCatalog);
      const paymentItem = paymentCatalog.find((item) => item.Codigo === paymentCode);
      const label = String(paymentItem?.Nombre || row.formaPago || "").trim() || "OTRO";
      const amountVed = this.paymentUsesUsdAmount(row.formaPago)
        ? this.convertUsdToBs(row.monto, tasaCambio)
        : row.monto;
      const amountUsd = this.paymentUsesUsdAmount(row.formaPago)
        ? row.monto
        : ZERO;

      return {
        label,
        totalVed: amountVed.toDecimalPlaces(2).toString(),
        totalUsd: amountUsd.toDecimalPlaces(2).toString(),
        movimientos: 1,
      };
    });
  }

  private convertUsdToBs(amount: Prisma.Decimal, rate: Prisma.Decimal) {    if (rate.lessThanOrEqualTo(ZERO)) {
      return ZERO;
    }

    return amount.mul(rate).toDecimalPlaces(2);
  }

  private resolveHeaderPaymentCode(paymentCodes: number[], paymentCatalog: PaymentCatalogRow[]) {
    const uniqueCodes = [...new Set(paymentCodes)];
    if (!uniqueCodes.length) {
      throw new BadRequestException("No se pudo determinar la forma de pago principal.");
    }

    if (uniqueCodes.length === 1) {
      return uniqueCodes[0];
    }

    const multiple = paymentCatalog.find((item) => this.normalizeCatalogName(item.Nombre) === "MULTIPLE");
    return multiple?.Codigo ?? uniqueCodes[0];
  }

  private resolvePaymentCode(label: string, paymentCatalog: PaymentCatalogRow[]) {
    const normalizedLabel = this.normalizeCatalogName(label);
    const synonyms = this.getPaymentMethodAliases(normalizedLabel);
    const matched = paymentCatalog.find((item) => synonyms.includes(this.normalizeCatalogName(item.Nombre)));
    if (!matched) {
      throw new BadRequestException(`La forma de pago ${label} no existe en el catalogo local.`);
    }

    return matched.Codigo;
  }

  private getPaymentMethodAliases(label: string) {
    switch (label) {
      case "TARJETADEDEBITO":
        return ["TARJETADEDEBITO", "TARJETADEBITO", "DEBITO"];
      case "TARJETADECREDITO":
        return ["TARJETADECREDITO", "TARJETACREDITO", "CREDITO"];
      case "EFECTIVODOLAR":
        return ["EFECTIVODOLAR"];
      case "BIOPAGOMONEDERO":
        return ["BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGOMONEDERO", "BIOPAGO\\MONEDERO"];
      default:
        return [label];
    }
  }

  private paymentUsesUsdAmount(label: string) {
    return ["EFECTIVODOLAR", "USDT", "DOLARELECTRONICO"].includes(this.normalizeCatalogName(label));
  }

  private resolveSaleUsdRate(items: NormalizedSaleItem[], detailRate: Prisma.Decimal, mayorRate: Prisma.Decimal) {
    if (detailRate.greaterThan(ZERO)) {
      return detailRate.toDecimalPlaces(4);
    }

    return mayorRate.toDecimalPlaces(4);
  }

  private buildSaleDateTime(sessionDate: Date) {
    const value = new Date(sessionDate.getTime());
    const now = new Date();
    value.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return value;
  }

  private async resolveNextInvoiceNumber(tx: FacturacionTransactionClient, cajaActiva: ActiveCajaSession) {
    const { start, end } = this.getDayRange(cajaActiva.Fecha);
    const aggregate = await tx.ventas.aggregate({
      where: {
        Serie: cajaActiva.Serie,
        Fecha: {
          gte: start,
          lt: end,
        },
      },
      _max: {
        NumeroFactura: true,
      },
    });

    const facturaInicial = BigInt(cajaActiva.FacturaInicial?.toString() ?? "1");
    const facturaFinal = BigInt(cajaActiva.FacturaFinal?.toString() ?? "0");
    const ultimaFacturaCaja = BigInt(cajaActiva.caja?.UltimaFactura?.toString() ?? "0");
    const ultimaFacturaVenta = BigInt(aggregate._max.NumeroFactura?.toString() ?? "0");

    const currentMax = [facturaInicial - 1n, facturaFinal, ultimaFacturaCaja, ultimaFacturaVenta].reduce((max, value) => {
      return value > max ? value : max;
    }, 0n);

    return currentMax + 1n;
  }

  private resolveInventoryCost(inventory: Inventario | undefined) {
    if (!inventory) {
      return ZERO;
    }

    if (inventory.CostoPromedio.greaterThan(ZERO)) {
      return inventory.CostoPromedio;
    }

    if (inventory.UltimoCosto.greaterThan(ZERO)) {
      return inventory.UltimoCosto;
    }

    if (inventory.CostoInicial.greaterThan(ZERO)) {
      return inventory.CostoInicial;
    }

    return ZERO;
  }

  private resolveInventoryPriceForList(inventory: Inventario | undefined, priceList: "detal" | "mayor" | "afiliado") {
    if (!inventory) {
      return ZERO;
    }

    if (priceList === "mayor") {
      return inventory.PrecioMayor;
    }

    if (priceList === "afiliado") {
      return inventory.PrecioAfiliado;
    }

    return inventory.PrecioDetal;
  }

  private async updateInventoryExistence(
    tx: FacturacionTransactionClient,
    inventoryByCode: Map<string, Inventario>,
    items: NormalizedSaleItem[],
    movementDate: Date,
  ) {
    const totals = new Map<string, Prisma.Decimal>();
    for (const line of items) {
      const current = totals.get(line.codigoBarra) ?? ZERO;
      totals.set(line.codigoBarra, current.plus(line.cantidad));
    }

    for (const [codigoBarra, quantity] of totals.entries()) {
      const inventory = inventoryByCode.get(codigoBarra);
      if (!inventory) {
        continue;
      }

      await tx.inventario.update({
        where: {
          CodigoBarra: inventory.CodigoBarra,
        },
        data: {
          Existencia: inventory.Existencia.minus(quantity),
          FechaPrimerMovimiento: inventory.FechaPrimerMovimiento ?? movementDate,
          UltimaActualizacion: movementDate,
        },
      });
    }
  }

  private normalizePriceList(value: string | undefined): "detal" | "mayor" | "afiliado" {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "mayor") {
      return "mayor";
    }

    if (normalized === "afiliado") {
      return "afiliado";
    }

    return "detal";
  }

  private toLegacyPriceListCode(priceList: "detal" | "mayor" | "afiliado") {
    if (priceList === "mayor") {
      return "M";
    }

    if (priceList === "afiliado") {
      return "A";
    }

    return "D";
  }

  private parseDecimalInput(
    value: unknown,
    message: string,
    options: { allowEmpty?: boolean; defaultValue?: Prisma.Decimal } = {},
  ) {
    const allowEmpty = options.allowEmpty ?? false;
    const defaultValue = options.defaultValue ?? ZERO;
    const sanitized = String(value ?? "").trim().replace(/\s+/g, "");

    if (!sanitized) {
      if (allowEmpty) {
        return defaultValue;
      }

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

  private normalizeCatalogName(value: string | null | undefined) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
  }

  private normalizeCode(value: string | null | undefined) {
    return String(value || "").trim().toUpperCase();
  }

  private normalizeIdentityComparable(value: string | null | undefined) {
    const normalized = this.normalizeCode(value);
    if (!normalized) {
      return "";
    }

    const compact = normalized.replace(/[^A-Z0-9]/g, "");
    if (/^[VEJGEP]\d+$/i.test(compact)) {
      return compact.slice(1);
    }

    return compact;
  }

  private getDayRange(date: Date) {
    const start = new Date(date.getTime());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
}








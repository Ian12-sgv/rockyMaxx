import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Cajas } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { toCajaConfigView, toCajaView } from "./caja-view.util";
import { CreateCajaDto } from "./dto/create-caja.dto";
import { FindCajasDto } from "./dto/find-cajas.dto";
import { UpdateCajaDto } from "./dto/update-caja.dto";

const ZERO = new Prisma.Decimal(0);

type CajaTransactionClient = Prisma.TransactionClient;

type NormalizedCajaInput = {
  serie: string;
  fecha: Date;
  numeroCaja: number;
  facturaInicial: bigint;
  ultimaFactura: bigint;
  horaApertura: string;
  horaCierre?: string;
};

@Injectable()
export class CajasService {
  constructor(private readonly prisma: PrismaService) {}

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
            ReporteZTexto: "",
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

  private buildWhere(findCajasDto: FindCajasDto): Prisma.DiarioCajaWhereInput {
    const conditions: Prisma.DiarioCajaWhereInput[] = [];
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
        },
      });
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
        NombreImpresora: template?.NombreImpresora ?? "NO APLICA",
        NumeroCopias: template?.NumeroCopias ?? 1,
        IncluirIGTF: template?.IncluirIGTF ?? false,
      },
    });
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

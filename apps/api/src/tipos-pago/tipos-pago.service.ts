import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CreateTipoPagoDto } from "./dto/create-tipo-pago.dto";
import { FindTiposPagoDto } from "./dto/find-tipos-pago.dto";
import { UpdateTipoPagoDto } from "./dto/update-tipo-pago.dto";
import { toTipoPagoView } from "./tipo-pago-view.util";

@Injectable()
export class TiposPagoService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata() {
    const tiposPago = await this.prisma.formaPago.findMany({
      select: { Codigo: true },
      orderBy: [{ Codigo: "asc" }],
    });

    const nextCodigo = tiposPago.length
      ? Math.max(...tiposPago.map((item) => Number(item.Codigo || 0))) + 1
      : 1;

    return {
      defaults: {
        codigo: nextCodigo,
        status: 1,
      },
    };
  }

  async findAll(findTiposPagoDto: FindTiposPagoDto) {
    const tiposPago = await this.prisma.formaPago.findMany({
      where: this.buildWhere(findTiposPagoDto),
      orderBy: [{ Orden: "asc" }, { Status: "desc" }, { Nombre: "asc" }, { Codigo: "asc" }],
      take: findTiposPagoDto.limit ?? 100,
    });

    return tiposPago.map((item) => toTipoPagoView(item));
  }

  async findOne(codigo: number | string) {
    const tipoPago = await this.prisma.formaPago.findUnique({
      where: { Codigo: this.normalizeCodigo(codigo) },
    });

    if (!tipoPago) {
      throw new NotFoundException("Tipo de pago no encontrado.");
    }

    return toTipoPagoView(tipoPago);
  }

  async create(createTipoPagoDto: CreateTipoPagoDto) {
    const codigo = this.normalizeCodigo(createTipoPagoDto.codigo);
    const existing = await this.prisma.formaPago.findUnique({
      where: { Codigo: codigo },
    });

    if (existing) {
      throw new ConflictException("Ya existe un tipo de pago con ese codigo.");
    }

    const created = await this.prisma.formaPago.create({
      data: {
        Codigo: codigo,
        Nombre: this.normalizeRequiredText(createTipoPagoDto.nombre, "Debes indicar el nombre del tipo de pago."),
        Status: this.resolveStatus(createTipoPagoDto.status),
        Orden: codigo,
      },
    });

    return toTipoPagoView(created);
  }

  async update(codigo: number | string, updateTipoPagoDto: UpdateTipoPagoDto) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.formaPago.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Tipo de pago no encontrado.");
    }

    const updated = await this.prisma.formaPago.update({
      where: { Codigo: normalizedCodigo },
      data: {
        Nombre: this.normalizeRequiredText(updateTipoPagoDto.nombre, "Debes indicar el nombre del tipo de pago."),
        Status: this.resolveStatus(updateTipoPagoDto.status),
      },
    });

    return toTipoPagoView(updated);
  }

  async remove(codigo: number | string) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.formaPago.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Tipo de pago no encontrado.");
    }

    try {
      await this.prisma.formaPago.delete({
        where: { Codigo: normalizedCodigo },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException("No se puede eliminar el tipo de pago porque ya tiene movimientos relacionados.");
      }

      throw error;
    }
  }

  private buildWhere(findTiposPagoDto: FindTiposPagoDto): Prisma.FormaPagoWhereInput {
    const conditions: Prisma.FormaPagoWhereInput[] = [];
    const search = String(findTiposPagoDto.buscar || "").trim();
    const parsedCode = Number.parseInt(search, 10);

    if (typeof findTiposPagoDto.status === "number") {
      conditions.push({ Status: findTiposPagoDto.status });
    }

    if (search) {
      const searchConditions: Prisma.FormaPagoWhereInput[] = [
        { Nombre: { contains: search, mode: "insensitive" } },
      ];

      if (Number.isInteger(parsedCode)) {
        searchConditions.unshift({ Codigo: parsedCode });
      }

      conditions.push({ OR: searchConditions });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  private normalizeCodigo(value: number | string) {
    const normalized = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isInteger(normalized) || normalized <= 0) {
      throw new BadRequestException("Debes indicar un codigo numerico valido para el tipo de pago.");
    }

    return normalized;
  }

  private normalizeRequiredText(value: string | undefined, message: string) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private resolveStatus(value?: number) {
    return Number(value ?? 1) === 0 ? 0 : 1;
  }
}
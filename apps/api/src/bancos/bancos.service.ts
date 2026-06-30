import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { toBancoView } from "./banco-view.util";
import { CreateBancoDto } from "./dto/create-banco.dto";
import { FindBancosDto } from "./dto/find-bancos.dto";
import { UpdateBancoDto } from "./dto/update-banco.dto";

@Injectable()
export class BancosService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata() {
    const bancos = await this.prisma.bancos.findMany({
      select: { Codigo: true },
      orderBy: [{ Codigo: "asc" }],
    });

    return {
      defaults: {
        codigo: this.buildNextCodigo(bancos.map((item) => item.Codigo)),
        status: 1,
      },
    };
  }

  async findAll(findBancosDto: FindBancosDto) {
    const bancos = await this.prisma.bancos.findMany({
      where: this.buildWhere(findBancosDto),
      orderBy: [{ Status: "desc" }, { Nombre: "asc" }, { Codigo: "asc" }],
      take: findBancosDto.limit ?? 100,
    });

    return bancos.map((item) => toBancoView(item));
  }

  async findOne(codigo: string) {
    const banco = await this.prisma.bancos.findUnique({
      where: { Codigo: this.normalizeCodigo(codigo) },
    });

    if (!banco) {
      throw new NotFoundException("Banco no encontrado.");
    }

    return toBancoView(banco);
  }

  async create(createBancoDto: CreateBancoDto) {
    const codigo = this.normalizeCodigo(createBancoDto.codigo);
    const existing = await this.prisma.bancos.findUnique({
      where: { Codigo: codigo },
    });

    if (existing) {
      throw new ConflictException("Ya existe un banco con ese codigo.");
    }

    const created = await this.prisma.bancos.create({
      data: {
        Codigo: codigo,
        Nombre: this.normalizeRequiredText(createBancoDto.nombre, "Debes indicar el nombre del banco."),
        Status: this.resolveStatus(createBancoDto.status),
      },
    });

    return toBancoView(created);
  }

  async update(codigo: string, updateBancoDto: UpdateBancoDto) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.bancos.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Banco no encontrado.");
    }

    const updated = await this.prisma.bancos.update({
      where: { Codigo: normalizedCodigo },
      data: {
        Nombre: this.normalizeRequiredText(updateBancoDto.nombre, "Debes indicar el nombre del banco."),
        Status: this.resolveStatus(updateBancoDto.status),
      },
    });

    return toBancoView(updated);
  }

  async remove(codigo: string) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.bancos.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Banco no encontrado.");
    }

    try {
      await this.prisma.bancos.delete({
        where: { Codigo: normalizedCodigo },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException(
          "No se puede eliminar el banco porque ya tiene movimientos relacionados.",
        );
      }

      throw error;
    }
  }

  private buildWhere(findBancosDto: FindBancosDto): Prisma.BancosWhereInput {
    const conditions: Prisma.BancosWhereInput[] = [];
    const search = String(findBancosDto.buscar || "").trim();

    if (typeof findBancosDto.status === "number") {
      conditions.push({ Status: findBancosDto.status });
    }

    if (search) {
      conditions.push({
        OR: [
          { Codigo: { contains: search, mode: "insensitive" } },
          { Nombre: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  private buildNextCodigo(codigos: string[]) {
    const parsed = codigos
      .map((item) => {
        const normalized = String(item || "").trim();
        return {
          original: normalized,
          numeric: Number.parseInt(normalized, 10),
        };
      })
      .filter((item) => Number.isInteger(item.numeric));

    const nextValue = parsed.length ? Math.max(...parsed.map((item) => item.numeric)) + 1 : 1;
    const padLength = Math.max(3, parsed.reduce((max, item) => Math.max(max, item.original.length), 0));
    return String(nextValue).padStart(padLength, "0");
  }

  private normalizeCodigo(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar el codigo del banco.");
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

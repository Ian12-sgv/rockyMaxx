import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CreateSucursalDto } from "./dto/create-sucursal.dto";
import { FindSucursalesDto } from "./dto/find-sucursales.dto";
import { UpdateSucursalDto } from "./dto/update-sucursal.dto";
import { toSucursalView } from "./sucursal-view.util";

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class SucursalesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(findSucursalesDto: FindSucursalesDto) {
    const sucursales = await this.prisma.sucursales.findMany({
      where: this.buildWhere(findSucursalesDto),
      orderBy: [{ Status: "desc" }, { Codigo: "asc" }],
    });

    return sucursales.map((item) => toSucursalView(item));
  }

  async findOne(codigo: string) {
    const sucursal = await this.prisma.sucursales.findUnique({
      where: { Codigo: this.normalizeCode(codigo) },
    });

    if (!sucursal) {
      throw new NotFoundException("Sucursal no encontrada.");
    }

    return toSucursalView(sucursal);
  }

  async create(createSucursalDto: CreateSucursalDto) {
    const codigo = createSucursalDto.codigo
      ? this.normalizeCode(createSucursalDto.codigo)
      : await this.generateNextCode();

    const existing = await this.prisma.sucursales.findUnique({
      where: { Codigo: codigo },
    });

    if (existing) {
      throw new ConflictException("Ya existe una sucursal con ese codigo.");
    }

    const created = await this.prisma.sucursales.create({
      data: {
        Codigo: codigo,
        Nombre: this.resolveName(createSucursalDto.nombre, codigo),
        Direccion: this.normalizeText(createSucursalDto.direccion),
        Telefono: this.normalizeText(createSucursalDto.telefono),
        Status: this.resolveStatus(createSucursalDto.status),
        PorcentajeDeRedondeo: this.parsePercentage(createSucursalDto.porcentajeDeRedondeo),
      },
    });

    return toSucursalView(created);
  }

  async update(codigo: string, updateSucursalDto: UpdateSucursalDto) {
    const currentCode = this.normalizeCode(codigo);
    const existing = await this.prisma.sucursales.findUnique({
      where: { Codigo: currentCode },
    });

    if (!existing) {
      throw new NotFoundException("Sucursal no encontrada.");
    }

    const nextCode = updateSucursalDto.codigo ? this.normalizeCode(updateSucursalDto.codigo) : currentCode;

    if (nextCode !== currentCode) {
      const duplicate = await this.prisma.sucursales.findUnique({
        where: { Codigo: nextCode },
      });

      if (duplicate) {
        throw new ConflictException("Ya existe una sucursal con ese codigo.");
      }
    }

    const updated = await this.prisma.sucursales.update({
      where: { Codigo: currentCode },
      data: {
        Codigo: nextCode,
        Nombre: updateSucursalDto.nombre !== undefined
          ? this.normalizeText(updateSucursalDto.nombre)
          : existing.Nombre,
        Direccion: updateSucursalDto.direccion !== undefined
          ? this.normalizeText(updateSucursalDto.direccion)
          : existing.Direccion,
        Telefono: updateSucursalDto.telefono !== undefined
          ? this.normalizeText(updateSucursalDto.telefono)
          : existing.Telefono,
        Status: updateSucursalDto.status !== undefined
          ? this.resolveStatus(updateSucursalDto.status)
          : existing.Status,
        PorcentajeDeRedondeo: updateSucursalDto.porcentajeDeRedondeo !== undefined
          ? this.parsePercentage(updateSucursalDto.porcentajeDeRedondeo)
          : existing.PorcentajeDeRedondeo,
      },
    });

    return toSucursalView(updated);
  }

  private buildWhere(findSucursalesDto: FindSucursalesDto): Prisma.SucursalesWhereInput {
    const conditions: Prisma.SucursalesWhereInput[] = [];
    const search = String(findSucursalesDto.buscar || "").trim();

    if (typeof findSucursalesDto.status === "number") {
      conditions.push({ Status: findSucursalesDto.status });
    }

    if (search) {
      conditions.push({
        OR: [
          { Codigo: { contains: search, mode: "insensitive" } },
          { Nombre: { contains: search, mode: "insensitive" } },
          { Direccion: { contains: search, mode: "insensitive" } },
          { Telefono: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  private async generateNextCode() {
    const sucursales = await this.prisma.sucursales.findMany({
      select: { Codigo: true },
    });

    const numericCodes = sucursales
      .map((item) => Number.parseInt(item.Codigo, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    let next = numericCodes.length ? Math.max(...numericCodes) + 1 : 1;

    while (await this.prisma.sucursales.findUnique({ where: { Codigo: String(next).padStart(3, "0") } })) {
      next += 1;
    }

    return String(next).padStart(3, "0");
  }

  private normalizeCode(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar el codigo de la sucursal.");
    }

    return normalized;
  }

  private resolveName(value: string | undefined, codigo: string) {
    return this.normalizeText(value) || codigo;
  }

  private normalizeText(value: string | undefined) {
    return String(value || "").trim();
  }

  private resolveStatus(value: number | undefined) {
    if (value === undefined) {
      return 1;
    }

    if (![0, 1].includes(value)) {
      throw new BadRequestException("El status debe ser 0 cerrada o 1 abierta.");
    }

    return value;
  }

  private parsePercentage(value: string | undefined) {
    if (value === undefined) {
      return ZERO;
    }

    try {
      return new Prisma.Decimal(String(value || "0").trim() || "0");
    } catch {
      throw new BadRequestException("El porcentaje de redondeo no es valido.");
    }
  }
}

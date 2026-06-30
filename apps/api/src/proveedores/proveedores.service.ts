import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { toProveedorView, toTipoProveedorView } from "./proveedor-view.util";
import { CreateProveedorDto } from "./dto/create-proveedor.dto";
import { FindProveedoresDto } from "./dto/find-proveedores.dto";
import { UpdateProveedorDto } from "./dto/update-proveedor.dto";

@Injectable()
export class ProveedoresService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata() {
    const [tiposProveedor, proveedores] = await Promise.all([
      this.prisma.tiposProveedor.findMany({
        orderBy: [{ Status: "desc" }, { Descripcion: "asc" }, { Codigo: "asc" }],
      }),
      this.prisma.proveedores.findMany({
        select: { Codigo: true },
      }),
    ]);

    const defaultTipo = tiposProveedor.find((item) => Number(item.Status ?? 1) === 1)?.Codigo ?? tiposProveedor[0]?.Codigo ?? 1;

    return {
      defaults: {
        codigo: this.buildNextCodigo(proveedores.map((item) => item.Codigo)),
        tipo: defaultTipo,
        fechaIngreso: this.startOfDay(new Date()),
        status: 1,
        pais: "VENEZUELA",
      },
      tiposProveedor: tiposProveedor.map((item) => toTipoProveedorView(item)),
    };
  }

  async findAll(findProveedoresDto: FindProveedoresDto) {
    const proveedores = await this.prisma.proveedores.findMany({
      where: this.buildWhere(findProveedoresDto),
      include: {
        tipoProveedor: true,
      },
      orderBy: [{ Status: "desc" }, { Nombre: "asc" }, { Codigo: "asc" }],
      take: findProveedoresDto.limit ?? 100,
    });

    return proveedores.map((item) => toProveedorView(item));
  }

  async findOne(codigo: string) {
    const proveedor = await this.prisma.proveedores.findUnique({
      where: { Codigo: this.normalizeCodigo(codigo) },
      include: {
        tipoProveedor: true,
      },
    });

    if (!proveedor) {
      throw new NotFoundException("Proveedor no encontrado.");
    }

    return toProveedorView(proveedor);
  }

  async create(createProveedorDto: CreateProveedorDto) {
    const codigo = this.normalizeCodigo(createProveedorDto.codigo);
    const existing = await this.prisma.proveedores.findUnique({
      where: { Codigo: codigo },
    });

    if (existing) {
      throw new ConflictException("Ya existe un proveedor con ese codigo.");
    }

    await this.ensureTipoProveedorExists(createProveedorDto.tipo);

    const created = await this.prisma.proveedores.create({
      data: {
        Codigo: codigo,
        Tipo: createProveedorDto.tipo,
        Nombre: this.normalizeRequiredText(createProveedorDto.nombre, "Debes indicar el nombre del proveedor."),
        Contacto: this.normalizeOptionalText(createProveedorDto.contacto),
        FechaIngreso: this.startOfDay(createProveedorDto.fechaIngreso),
        Pais: this.normalizeStringOrEmpty(createProveedorDto.pais),
        Estado: this.normalizeStringOrEmpty(createProveedorDto.estado),
        Ciudad: this.normalizeStringOrEmpty(createProveedorDto.ciudad),
        CodigoPostal: this.normalizeStringOrEmpty(createProveedorDto.codigoPostal),
        Direccion: this.normalizeStringOrEmpty(createProveedorDto.direccion),
        Telefono: this.normalizeStringOrEmpty(createProveedorDto.telefono),
        Fax: this.normalizeStringOrEmpty(createProveedorDto.fax),
        Status: this.resolveStatus(createProveedorDto.status),
      },
      include: {
        tipoProveedor: true,
      },
    });

    return toProveedorView(created);
  }

  async update(codigo: string, updateProveedorDto: UpdateProveedorDto) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.proveedores.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Proveedor no encontrado.");
    }

    await this.ensureTipoProveedorExists(updateProveedorDto.tipo);

    const updated = await this.prisma.proveedores.update({
      where: { Codigo: normalizedCodigo },
      data: {
        Tipo: updateProveedorDto.tipo,
        Nombre: this.normalizeRequiredText(updateProveedorDto.nombre, "Debes indicar el nombre del proveedor."),
        Contacto: this.normalizeOptionalText(updateProveedorDto.contacto),
        FechaIngreso: this.startOfDay(updateProveedorDto.fechaIngreso),
        Pais: this.normalizeStringOrEmpty(updateProveedorDto.pais),
        Estado: this.normalizeStringOrEmpty(updateProveedorDto.estado),
        Ciudad: this.normalizeStringOrEmpty(updateProveedorDto.ciudad),
        CodigoPostal: this.normalizeStringOrEmpty(updateProveedorDto.codigoPostal),
        Direccion: this.normalizeStringOrEmpty(updateProveedorDto.direccion),
        Telefono: this.normalizeStringOrEmpty(updateProveedorDto.telefono),
        Fax: this.normalizeStringOrEmpty(updateProveedorDto.fax),
        Status: this.resolveStatus(updateProveedorDto.status),
      },
      include: {
        tipoProveedor: true,
      },
    });

    return toProveedorView(updated);
  }

  async remove(codigo: string) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.proveedores.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Proveedor no encontrado.");
    }

    try {
      await this.prisma.proveedores.delete({
        where: { Codigo: normalizedCodigo },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException(
          "No se puede eliminar el proveedor porque ya tiene compras o movimientos relacionados.",
        );
      }

      throw error;
    }
  }

  private buildWhere(findProveedoresDto: FindProveedoresDto): Prisma.ProveedoresWhereInput {
    const conditions: Prisma.ProveedoresWhereInput[] = [];
    const search = String(findProveedoresDto.buscar || "").trim();

    if (typeof findProveedoresDto.status === "number") {
      conditions.push({ Status: findProveedoresDto.status });
    }

    if (search) {
      conditions.push({
        OR: [
          { Codigo: { contains: search, mode: "insensitive" } },
          { Nombre: { contains: search, mode: "insensitive" } },
          { Contacto: { contains: search, mode: "insensitive" } },
          { Telefono: { contains: search, mode: "insensitive" } },
          { Ciudad: { contains: search, mode: "insensitive" } },
          { Pais: { contains: search, mode: "insensitive" } },
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

  private async ensureTipoProveedorExists(tipo?: number) {
    if (!Number.isInteger(tipo)) {
      throw new BadRequestException("Debes indicar el tipo de proveedor.");
    }

    const existing = await this.prisma.tiposProveedor.findUnique({
      where: { Codigo: tipo },
    });

    if (!existing) {
      throw new BadRequestException("El tipo de proveedor indicado no existe.");
    }
  }

  private normalizeCodigo(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar el codigo del proveedor.");
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

  private normalizeOptionalText(value: string | undefined) {
    const normalized = String(value || "").trim();
    return normalized ? normalized : null;
  }

  private normalizeStringOrEmpty(value: string | undefined) {
    return String(value || "").trim();
  }

  private resolveStatus(value?: number) {
    return Number(value ?? 1) === 0 ? 0 : 1;
  }

  private startOfDay(value: Date) {
    const result = new Date(value);
    result.setHours(0, 0, 0, 0);
    return result;
  }
}

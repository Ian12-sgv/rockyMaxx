import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { toClienteView, toTipoClienteView, toTipoContribuyenteView } from "./cliente-view.util";
import { CreateClienteDto } from "./dto/create-cliente.dto";
import { FindClientesDto } from "./dto/find-clientes.dto";
import { UpdateClienteDto } from "./dto/update-cliente.dto";

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async getMetadata() {
    const [tiposCliente, tiposContribuyente, clientes] = await Promise.all([
      this.prisma.tiposCliente.findMany({
        orderBy: [{ Status: "desc" }, { Descripcion: "asc" }, { Codigo: "asc" }],
      }),
      this.prisma.tiposContribuyente.findMany({
        orderBy: [{ Status: "desc" }, { Descripcion: "asc" }, { Codigo: "asc" }],
      }),
      this.prisma.clientes.findMany({
        select: { Codigo: true },
      }),
    ]);

    const nextCodigo = this.buildNextCodigo(clientes.map((item) => item.Codigo));
    const defaultTipo = tiposCliente.find((item) => Number(item.Status ?? 1) === 1)?.Codigo ?? tiposCliente[0]?.Codigo ?? 1;
    const defaultTipoContribuyente =
      tiposContribuyente.find((item) => Number(item.Status ?? 1) === 1)?.Codigo
      ?? tiposContribuyente[0]?.Codigo
      ?? 1;

    return {
      defaults: {
        codigo: nextCodigo,
        fechaIngreso: this.startOfDay(new Date()),
        status: 1,
        tipo: defaultTipo,
        tipoContribuyente: defaultTipoContribuyente,
      },
      tiposCliente: tiposCliente.map((item) => toTipoClienteView(item)),
      tiposContribuyente: tiposContribuyente.map((item) => toTipoContribuyenteView(item)),
    };
  }

  async findAll(findClientesDto: FindClientesDto) {
    const clientes = await this.prisma.clientes.findMany({
      where: this.buildWhere(findClientesDto),
      include: {
        tipoCliente: true,
        contribuyenteTipo: true,
      },
      orderBy: [{ Status: "desc" }, { Nombre: "asc" }, { Codigo: "asc" }],
      take: findClientesDto.limit ?? 100,
    });

    return clientes.map((item) => toClienteView(item));
  }

  async findOne(codigo: string) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { Codigo: this.normalizeCodigo(codigo) },
      include: {
        tipoCliente: true,
        contribuyenteTipo: true,
      },
    });

    if (!cliente) {
      throw new NotFoundException("Cliente no encontrado.");
    }

    return toClienteView(cliente);
  }

  async create(createClienteDto: CreateClienteDto) {
    const codigo = this.normalizeCodigo(createClienteDto.codigo);
    const existing = await this.prisma.clientes.findUnique({
      where: { Codigo: codigo },
    });

    if (existing) {
      throw new ConflictException("Ya existe un cliente con esa cedula o RIF.");
    }

    await this.ensureTipoClienteExists(createClienteDto.tipo);
    await this.ensureTipoContribuyenteExists(createClienteDto.tipoContribuyente);

    const created = await this.prisma.$transaction(async (tx) => {
      const record = await tx.clientes.create({
        data: {
          Codigo: codigo,
          Nombre: this.normalizeRequiredText(createClienteDto.nombre, "Debes indicar el nombre del cliente."),
          FechaIngreso: this.startOfDay(createClienteDto.fechaIngreso),
          Telefono: this.normalizeOptionalText(createClienteDto.telefono),
          Direccion: this.normalizeOptionalText(createClienteDto.direccion),
          Status: this.resolveStatus(createClienteDto.status),
          Tipo: createClienteDto.tipo,
          TipoContribuyente: createClienteDto.tipoContribuyente,
        },
        include: {
          tipoCliente: true,
          contribuyenteTipo: true,
        },
      });

      await this.mirrorSyncService.enqueueClienteUpsertTx(tx, record.Codigo);
      return record;
    });

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    return toClienteView(created);
  }

  async update(codigo: string, updateClienteDto: UpdateClienteDto) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.clientes.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Cliente no encontrado.");
    }

    await this.ensureTipoClienteExists(updateClienteDto.tipo);
    await this.ensureTipoContribuyenteExists(updateClienteDto.tipoContribuyente);

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.clientes.update({
        where: { Codigo: normalizedCodigo },
        data: {
          Nombre: this.normalizeRequiredText(updateClienteDto.nombre, "Debes indicar el nombre del cliente."),
          FechaIngreso: this.startOfDay(updateClienteDto.fechaIngreso),
          Telefono: this.normalizeOptionalText(updateClienteDto.telefono),
          Direccion: this.normalizeOptionalText(updateClienteDto.direccion),
          Status: this.resolveStatus(updateClienteDto.status),
          Tipo: updateClienteDto.tipo,
          TipoContribuyente: updateClienteDto.tipoContribuyente,
        },
        include: {
          tipoCliente: true,
          contribuyenteTipo: true,
        },
      });

      await this.mirrorSyncService.enqueueClienteUpsertTx(tx, record.Codigo);
      return record;
    });

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    return toClienteView(updated);
  }

  async remove(codigo: string) {
    const normalizedCodigo = this.normalizeCodigo(codigo);
    const existing = await this.prisma.clientes.findUnique({
      where: { Codigo: normalizedCodigo },
    });

    if (!existing) {
      throw new NotFoundException("Cliente no encontrado.");
    }

    try {
      await this.prisma.clientes.delete({
        where: { Codigo: normalizedCodigo },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException(
          "No se puede eliminar el cliente porque ya tiene movimientos relacionados.",
        );
      }

      throw error;
    }
  }

  private buildWhere(findClientesDto: FindClientesDto): Prisma.ClientesWhereInput {
    const conditions: Prisma.ClientesWhereInput[] = [];
    const search = String(findClientesDto.buscar || "").trim();

    if (typeof findClientesDto.status === "number") {
      conditions.push({ Status: findClientesDto.status });
    }

    if (search) {
      conditions.push({
        OR: [
          { Codigo: { contains: search, mode: "insensitive" } },
          { Nombre: { contains: search, mode: "insensitive" } },
          { Telefono: { contains: search, mode: "insensitive" } },
          { Direccion: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  private buildNextCodigo(codigos: string[]) {
    const numericCodes = codigos
      .map((item) => Number.parseInt(String(item || "").trim(), 10))
      .filter((item) => Number.isInteger(item));

    return numericCodes.length ? String(Math.max(...numericCodes) + 1) : "1";
  }

  private async ensureTipoClienteExists(tipo?: number) {
    if (!Number.isInteger(tipo)) {
      throw new BadRequestException("Debes indicar el tipo de cliente.");
    }

    const existing = await this.prisma.tiposCliente.findUnique({
      where: { Codigo: tipo },
    });

    if (!existing) {
      throw new BadRequestException("El tipo de cliente indicado no existe.");
    }
  }

  private async ensureTipoContribuyenteExists(tipoContribuyente?: number) {
    if (!Number.isInteger(tipoContribuyente)) {
      throw new BadRequestException("Debes indicar el tipo de contribuyente.");
    }

    const existing = await this.prisma.tiposContribuyente.findUnique({
      where: { Codigo: tipoContribuyente },
    });

    if (!existing) {
      throw new BadRequestException("El tipo de contribuyente indicado no existe.");
    }
  }

  private normalizeCodigo(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar la cedula o RIF del cliente.");
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
    return String(value || "").trim();
  }

  private resolveStatus(value: number | undefined) {
    if (value === undefined) {
      return 1;
    }

    if (![0, 1].includes(value)) {
      throw new BadRequestException("El status debe ser 0 inactivo o 1 activo.");
    }

    return value;
  }

  private startOfDay(date: Date) {
    const normalized = new Date(date.getTime());
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }
}

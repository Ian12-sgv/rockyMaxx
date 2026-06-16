import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTrabajadorDto } from "./dto/create-trabajador.dto";
import { FindTrabajadoresDto } from "./dto/find-trabajadores.dto";
import { UpdateTrabajadorDto } from "./dto/update-trabajador.dto";
import { toCargoView, toTrabajadorView } from "./trabajador-view.util";

@Injectable()
export class TrabajadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async getMetadata() {
    const [cargos, trabajadores] = await Promise.all([
      this.prisma.cargos.findMany({
        orderBy: [{ Status: "desc" }, { Nombre: "asc" }, { Codigo: "asc" }],
      }),
      this.prisma.trabajadores.findMany({
        select: { Codigo: true },
      }),
    ]);

    const nextCodigo = trabajadores.length
      ? Math.max(...trabajadores.map((item) => Number(item.Codigo || 0))) + 1
      : 1;

    return {
      defaults: {
        codigo: nextCodigo,
        fechaIngreso: this.startOfDay(new Date()),
        fechaNacimiento: this.startOfDay(new Date()),
        status: 1,
      },
      cargos: cargos.map((item) => toCargoView(item)),
    };
  }

  async findAll(findTrabajadoresDto: FindTrabajadoresDto) {
    const trabajadores = await this.prisma.trabajadores.findMany({
      where: this.buildWhere(findTrabajadoresDto),
      include: { cargoRef: true },
      orderBy: [{ Status: "desc" }, { Nombre: "asc" }, { Cedula: "asc" }],
      take: findTrabajadoresDto.limit ?? 100,
    });

    return trabajadores.map((item) => toTrabajadorView(item));
  }

  async findOne(cedula: string) {
    const trabajador = await this.prisma.trabajadores.findUnique({
      where: { Cedula: this.normalizeCedula(cedula) },
      include: { cargoRef: true },
    });

    if (!trabajador) {
      throw new NotFoundException("Trabajador no encontrado.");
    }

    return toTrabajadorView(trabajador);
  }

  async create(createTrabajadorDto: CreateTrabajadorDto) {
    const cedula = this.normalizeCedula(createTrabajadorDto.cedula);
    const existing = await this.prisma.trabajadores.findUnique({
      where: { Cedula: cedula },
    });

    if (existing) {
      throw new ConflictException("Ya existe un trabajador con esa cedula.");
    }

    const codigo = createTrabajadorDto.codigo ?? await this.generateNextCodigo();
    await this.ensureCodigoAvailable(codigo);
    await this.ensureCargoExists(createTrabajadorDto.cargo);

    const created = await this.prisma.$transaction(async (tx) => {
      const record = await tx.trabajadores.create({
        data: {
          Cedula: cedula,
          Codigo: codigo,
          Nombre: this.normalizeRequiredText(createTrabajadorDto.nombre, "Debes indicar el nombre del trabajador."),
          Cargo: this.normalizeCargo(createTrabajadorDto.cargo),
          FechaIngreso: this.startOfDay(createTrabajadorDto.fechaIngreso),
          FechaNacimiento: this.resolveFechaNacimiento(
            createTrabajadorDto.fechaNacimiento,
            createTrabajadorDto.fechaIngreso,
          ),
          Direccion: this.normalizeOptionalText(createTrabajadorDto.direccion),
          Telefono: this.normalizeOptionalText(createTrabajadorDto.telefono),
          Celular: this.normalizeOptionalText(createTrabajadorDto.celular),
          Status: this.resolveStatus(createTrabajadorDto.status),
          MarcajeInterDiario: false,
          IndUsarCarnet: 0,
        },
        include: { cargoRef: true },
      });

      await this.mirrorSyncService.enqueueTrabajadorUpsertTx(tx, record.Cedula);
      return record;
    });

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    return toTrabajadorView(created);
  }

  async update(cedula: string, updateTrabajadorDto: UpdateTrabajadorDto) {
    const normalizedCedula = this.normalizeCedula(cedula);
    const existing = await this.prisma.trabajadores.findUnique({
      where: { Cedula: normalizedCedula },
    });

    if (!existing) {
      throw new NotFoundException("Trabajador no encontrado.");
    }

    const nextCodigo = updateTrabajadorDto.codigo ?? existing.Codigo;
    await this.ensureCodigoAvailable(nextCodigo, normalizedCedula);
    await this.ensureCargoExists(updateTrabajadorDto.cargo);

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.trabajadores.update({
        where: { Cedula: normalizedCedula },
        data: {
          Codigo: nextCodigo,
          Nombre: this.normalizeRequiredText(updateTrabajadorDto.nombre, "Debes indicar el nombre del trabajador."),
          Cargo: this.normalizeCargo(updateTrabajadorDto.cargo),
          FechaIngreso: this.startOfDay(updateTrabajadorDto.fechaIngreso),
          FechaNacimiento: this.resolveFechaNacimiento(
            updateTrabajadorDto.fechaNacimiento,
            updateTrabajadorDto.fechaIngreso,
          ),
          Direccion: this.normalizeOptionalText(updateTrabajadorDto.direccion),
          Telefono: this.normalizeOptionalText(updateTrabajadorDto.telefono),
          Celular: this.normalizeOptionalText(updateTrabajadorDto.celular),
          Status: this.resolveStatus(updateTrabajadorDto.status),
        },
        include: { cargoRef: true },
      });

      await this.mirrorSyncService.enqueueTrabajadorUpsertTx(tx, record.Cedula);
      return record;
    });

    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    return toTrabajadorView(updated);
  }

  async remove(cedula: string) {
    const normalizedCedula = this.normalizeCedula(cedula);
    const existing = await this.prisma.trabajadores.findUnique({
      where: { Cedula: normalizedCedula },
    });

    if (!existing) {
      throw new NotFoundException("Trabajador no encontrado.");
    }

    try {
      await this.prisma.trabajadores.delete({
        where: { Cedula: normalizedCedula },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException(
          "No se puede eliminar el trabajador porque ya tiene movimientos relacionados.",
        );
      }

      throw error;
    }
  }

  private buildWhere(findTrabajadoresDto: FindTrabajadoresDto): Prisma.TrabajadoresWhereInput {
    const conditions: Prisma.TrabajadoresWhereInput[] = [];
    const search = String(findTrabajadoresDto.buscar || "").trim();

    if (typeof findTrabajadoresDto.status === "number") {
      conditions.push({ Status: findTrabajadoresDto.status });
    }

    if (search) {
      const parsedCode = Number.parseInt(search, 10);
      conditions.push({
        OR: [
          { Cedula: { contains: search, mode: "insensitive" } },
          Number.isInteger(parsedCode) ? { Codigo: parsedCode } : {},
          { Nombre: { contains: search, mode: "insensitive" } },
          { Cargo: { contains: search, mode: "insensitive" } },
          { Telefono: { contains: search, mode: "insensitive" } },
          { Celular: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    return conditions.length ? { AND: conditions } : {};
  }

  private async generateNextCodigo() {
    const trabajadores = await this.prisma.trabajadores.findMany({
      select: { Codigo: true },
    });

    return trabajadores.length
      ? Math.max(...trabajadores.map((item) => Number(item.Codigo || 0))) + 1
      : 1;
  }

  private async ensureCodigoAvailable(codigo: number, currentCedula?: string) {
    const duplicate = await this.prisma.trabajadores.findFirst({
      where: {
        Codigo: codigo,
        ...(currentCedula ? { NOT: { Cedula: currentCedula } } : {}),
      },
      select: { Cedula: true },
    });

    if (duplicate) {
      throw new ConflictException("Ya existe un trabajador con ese codigo.");
    }
  }

  private async ensureCargoExists(cargo: string) {
    const normalizedCargo = this.normalizeCargo(cargo);
    const existing = await this.prisma.cargos.findUnique({
      where: { Codigo: normalizedCargo },
    });

    if (!existing) {
      throw new BadRequestException("El cargo indicado no existe.");
    }
  }

  private normalizeCedula(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar la cedula del trabajador.");
    }

    return normalized;
  }

  private normalizeCargo(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar el cargo del trabajador.");
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

  private resolveFechaNacimiento(fechaNacimiento: Date | undefined, fechaIngreso: Date) {
    return this.startOfDay(fechaNacimiento ?? fechaIngreso);
  }
}

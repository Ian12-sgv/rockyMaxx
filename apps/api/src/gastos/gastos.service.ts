import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { UserView } from "../users/user-view.util";
import { CreateGastoDto } from "./dto/create-gasto.dto";
import { FindGastosDto } from "./dto/find-gastos.dto";
import { UpdateGastoDto } from "./dto/update-gasto.dto";
import {
  GASTO_CATEGORIAS,
  GASTO_MONEDAS,
  GASTO_STATUS_ACTIVO,
  GASTO_STATUS_ANULADO,
} from "./gasto-dto.helpers";

type GastoRow = Prisma.GastosGetPayload<object>;

@Injectable()
export class GastosService {
  private readonly logger = new Logger(GastosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  getMetadata() {
    return {
      categorias: [...GASTO_CATEGORIAS],
      monedas: [...GASTO_MONEDAS],
      defaults: {
        categoria: "SERVICIOS",
        moneda: "BS",
      },
    };
  }

  async findAll(findGastosDto: FindGastosDto) {
    const desde = findGastosDto.desde ? this.parseFecha(findGastosDto.desde) : undefined;
    const hasta = findGastosDto.hasta ? this.parseFecha(findGastosDto.hasta) : undefined;
    if (desde && hasta && desde > hasta) {
      throw new BadRequestException("La fecha desde no puede ser mayor que la fecha hasta.");
    }

    const fechaFilter: Prisma.DateTimeFilter | undefined =
      desde || hasta
        ? {
            ...(desde ? { gte: desde } : {}),
            ...(hasta ? { lte: hasta } : {}),
          }
        : undefined;

    const where: Prisma.GastosWhereInput = {
      ...(fechaFilter ? { Fecha: fechaFilter } : {}),
      ...(findGastosDto.incluirAnulados ? {} : { Status: GASTO_STATUS_ACTIVO }),
    };

    const gastos = await this.prisma.gastos.findMany({
      where,
      orderBy: [{ Fecha: "desc" }, { ID: "desc" }],
      take: findGastosDto.limit ?? 500,
    });

    // Los totales salen de la base (no de la pagina devuelta) y van separados por
    // moneda: el monto se guarda tal cual se tipeo, sin convertir. Los anulados no suman.
    const totalesRows = await this.prisma.gastos.groupBy({
      by: ["Moneda"],
      where: { ...where, Status: GASTO_STATUS_ACTIVO },
      _sum: { Monto: true },
      _count: { _all: true },
    });

    const totales = GASTO_MONEDAS.map((moneda) => {
      const row = totalesRows.find((item) => item.Moneda === moneda);
      return {
        moneda,
        monto: new Prisma.Decimal(row?._sum.Monto ?? 0).toFixed(2),
        cantidad: row?._count._all ?? 0,
      };
    });

    return {
      gastos: gastos.map((item) => this.toView(item)),
      totales,
    };
  }

  async findOne(id: string) {
    const gasto = await this.prisma.gastos.findUnique({
      where: { ID: this.parseId(id) },
    });

    if (!gasto) {
      throw new NotFoundException("Gasto no encontrado.");
    }

    return this.toView(gasto);
  }

  async create(createGastoDto: CreateGastoDto, user: UserView) {
    const data = this.buildData(createGastoDto);

    const created = await this.prisma.$transaction(async (tx) => {
      const gasto = await tx.gastos.create({
        data: {
          ...data,
          Usuario: this.normalizeUsuario(user),
          Status: GASTO_STATUS_ACTIVO,
        },
      });

      await this.mirrorSyncService.enqueueGastoUpsertTx(tx, gasto.ID);
      return gasto;
    });

    this.pushMirrorSync();
    return this.toView(created);
  }

  async update(id: string, updateGastoDto: UpdateGastoDto) {
    const gastoId = this.parseId(id);
    const data = this.buildData(updateGastoDto);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertGastoActivo(tx, gastoId);

      const gasto = await tx.gastos.update({
        where: { ID: gastoId },
        data: {
          ...data,
          ActualizadoEn: new Date(),
        },
      });

      await this.mirrorSyncService.enqueueGastoUpsertTx(tx, gasto.ID);
      return gasto;
    });

    this.pushMirrorSync();
    return this.toView(updated);
  }

  async anular(id: string) {
    const gastoId = this.parseId(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertGastoActivo(tx, gastoId);

      const gasto = await tx.gastos.update({
        where: { ID: gastoId },
        data: {
          Status: GASTO_STATUS_ANULADO,
          ActualizadoEn: new Date(),
        },
      });

      await this.mirrorSyncService.enqueueGastoUpsertTx(tx, gasto.ID);
      return gasto;
    });

    this.pushMirrorSync();
    return this.toView(updated);
  }

  private async assertGastoActivo(tx: Prisma.TransactionClient, id: bigint) {
    const existing = await tx.gastos.findUnique({
      where: { ID: id },
      select: { Status: true },
    });

    if (!existing) {
      throw new NotFoundException("Gasto no encontrado.");
    }

    if (existing.Status !== GASTO_STATUS_ACTIVO) {
      throw new BadRequestException("El gasto esta anulado y ya no se puede modificar.");
    }
  }

  private buildData(dto: CreateGastoDto) {
    const monto = new Prisma.Decimal(dto.monto);
    if (monto.lte(0)) {
      throw new BadRequestException("El monto del gasto debe ser mayor que cero.");
    }

    return {
      Fecha: this.parseFecha(dto.fecha),
      Categoria: dto.categoria,
      Descripcion: dto.descripcion,
      Moneda: dto.moneda,
      Monto: monto,
      Referencia: dto.referencia ?? null,
    };
  }

  // Se envia en segundo plano despues del commit: si el VPS no responde, el gasto
  // queda PENDING en MIRROR_SYNC_OUTBOX y lo reintenta el ciclo automatico del espejo.
  private pushMirrorSync() {
    void this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }).catch((error: unknown) => {
      this.logger.warn(
        `No se pudo enviar el gasto al VPS: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private parseFecha(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException("Fecha de gasto invalida.");
    }

    return date;
  }

  private parseId(value: string) {
    const normalized = String(value ?? "").trim();
    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException("ID de gasto invalido.");
    }

    return BigInt(normalized);
  }

  private normalizeUsuario(user: UserView) {
    return String(user?.codUsuario || "").trim().toUpperCase().slice(0, 15) || "SISTEMA";
  }

  private toView(gasto: GastoRow) {
    return {
      id: gasto.ID.toString(),
      fecha: gasto.Fecha.toISOString().slice(0, 10),
      categoria: gasto.Categoria,
      descripcion: gasto.Descripcion,
      moneda: gasto.Moneda,
      monto: new Prisma.Decimal(gasto.Monto).toFixed(2),
      referencia: gasto.Referencia ?? "",
      usuario: gasto.Usuario,
      status: gasto.Status,
      creadoEn: gasto.CreadoEn.toISOString(),
      actualizadoEn: gasto.ActualizadoEn.toISOString(),
    };
  }
}

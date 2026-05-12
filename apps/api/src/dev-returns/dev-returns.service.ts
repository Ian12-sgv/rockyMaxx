import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Inventario } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { UserView } from "../users/user-view.util";
import { ApproveDevReturnDto } from "./dto/approve-dev-return.dto";
import { CreateDevDraftDto, CreateDevDraftLineDto } from "./dto/create-dev-draft.dto";
import { FindDevDraftsDto } from "./dto/find-dev-drafts.dto";

const ZERO = new Prisma.Decimal(0);

type DevReturnTransactionClient = Prisma.TransactionClient;
const devDraftInclude = Prisma.validator<Prisma.DevBorradorInclude>()({
  movimientos: {
    orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
    include: { inventarioRef: true },
  },
  usuarioRef: true,
});
type DevDraftWithRelations = Prisma.DevBorradorGetPayload<{ include: typeof devDraftInclude }>;

type NormalizedDevDraftLine = {
  item: number;
  codigoBarra: string;
  cantidad: Prisma.Decimal;
  numeroCaja: number;
  costo: Prisma.Decimal;
  articulo: Inventario;
};

@Injectable()
export class DevReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  async searchDrafts(findDevDraftsDto: FindDevDraftsDto) {
    const limit = findDevDraftsDto.limit ?? 25;
    const buscar = String(findDevDraftsDto.buscar || "").trim();

    const items = await this.prisma.devBorrador.findMany({
      where: {
        ...(findDevDraftsDto.status === undefined ? {} : { Status: findDevDraftsDto.status }),
        ...(buscar
          ? {
              OR: [
                Number.isInteger(Number(buscar)) ? { Numero: BigInt(buscar) } : {},
                { Observacion: { contains: buscar, mode: "insensitive" } },
                { Usuario: { contains: buscar, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        movimientos: {
          orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
          include: { inventarioRef: true },
        },
        usuarioRef: true,
      },
      orderBy: { Numero: "desc" },
      take: limit,
    });

    return {
      items: items.map((item) => this.toDraftView(item)),
    };
  }

  async findDraft(numero: bigint) {
    return {
      borrador: this.toDraftView(await this.findDraftOrThrow(this.prisma, numero)),
    };
  }

  async createDraft(createDevDraftDto: CreateDevDraftDto, user: UserView) {
    const borrador = await this.prisma.$transaction(
      async (tx) => {
        const numero = await this.getNextDraftNumber(tx);
        const fecha = createDevDraftDto.fecha ?? new Date();
        const lines = await this.normalizeDraftLines(tx, createDevDraftDto.items || []);

        if (lines.length === 0) {
          throw new BadRequestException("El borrador de devolucion debe tener al menos un renglon.");
        }

        await tx.devBorrador.create({
          data: {
            Numero: numero,
            Fecha: fecha,
            Observacion: String(createDevDraftDto.observacion || "").trim(),
            Usuario: user.codUsuario,
            Status: 0,
          },
        });

        await tx.movDevBorrador.createMany({
          data: lines.map((line) => ({
            Numero: numero,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            Costo: line.costo,
          })),
        });

        return this.findDraftOrThrow(tx, numero);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      borrador: this.toDraftView(borrador),
    };
  }

  async approveDraftAtDestination(numero: bigint) {
    const borrador = await this.prisma.$transaction(
      async (tx) => {
        const existing = await this.findDraftOrThrow(tx, numero);

        if (existing.Status !== 0) {
          throw new ConflictException("El borrador de devolucion ya fue aprobado por el destino.");
        }

        await tx.devBorrador.update({
          where: { Numero: existing.Numero },
          data: { Status: 1 },
        });

        return this.findDraftOrThrow(tx, numero);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      borrador: this.toDraftView(borrador),
    };
  }

  async approveReturnAtOrigin(numero: bigint, approveDevReturnDto: ApproveDevReturnDto, user: UserView) {
    const devolucion = await this.prisma.$transaction(
      async (tx) => {
        const draft = await this.findDraftOrThrow(tx, numero);

        if (draft.Status !== 1) {
          throw new ConflictException("El destino debe aprobar el borrador antes de cerrar la devolucion.");
        }

        await this.ensureReturnReferences(tx, approveDevReturnDto);
        const existingReturn = await tx.devTransferencias.findUnique({
          where: { Numero: Number(draft.Numero) },
        });

        if (existingReturn) {
          throw new ConflictException("La devolucion ya fue aprobada por el origen.");
        }

        const totalValor = this.calculateDraftTotal(draft.movimientos);

        await this.applyInventoryDelta(tx, this.aggregateDraftQuantities(draft.movimientos).negated);

        await tx.devTransferencias.create({
          data: {
            Numero: Number(draft.Numero),
            Fecha: draft.Fecha,
            CodigoEnvia: approveDevReturnDto.codigoEnvia,
            CodigoRecibe: approveDevReturnDto.codigoRecibe,
            DocumentoOrigen: approveDevReturnDto.codigoOrigen || "",
            TotalValor: totalValor,
            Observacion: draft.Observacion,
            Status: 0,
            Usuario: user.codUsuario,
            FechaEmision: approveDevReturnDto.fechaEmision ?? new Date(),
            InterContable: approveDevReturnDto.interContable ?? 0,
            IDLote: approveDevReturnDto.idLote,
          },
        });

        await tx.movDevTransferencias.createMany({
          data: draft.movimientos.map((line) => ({
            Numero: Number(draft.Numero),
            Fecha: draft.Fecha,
            CodigoBarra: line.CodigoBarra,
            Cantidad: line.Cantidad,
            Valor: line.Costo,
            NumeroCaja: line.NumeroCaja,
            Item: line.Item,
            UltimoCosto: line.inventarioRef.UltimoCosto,
            CostoInicial: line.inventarioRef.CostoInicial,
            CostoDolar: line.inventarioRef.CostoDolar,
          })),
        });

        await tx.devBorrador.update({
          where: { Numero: draft.Numero },
          data: { Status: 2 },
        });

        return tx.devTransferencias.findUniqueOrThrow({
          where: { Numero: Number(draft.Numero) },
          include: {
            movDevTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
              include: { inventarioRef: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      devolucion: this.toReturnView(devolucion),
    };
  }

  async approveReturnAtDestination(numero: number, user: UserView) {
    const devolucion = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.devTransferencias.findUnique({
          where: { Numero: numero },
          include: {
            movDevTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
              include: { inventarioRef: true },
            },
          },
        });

        if (!existing) {
          throw new NotFoundException("La devolucion no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("La devolucion ya fue recibida por el destino.");
        }

        const existingReceived = await tx.iDevTransferencias.findUnique({
          where: {
            Numero_CodigoEnvia: {
              Numero: existing.Numero,
              CodigoEnvia: existing.CodigoEnvia,
            },
          },
        });

        if (existingReceived) {
          throw new ConflictException("La devolucion recibida ya fue registrada.");
        }

        await this.applyInventoryDelta(tx, this.aggregateReturnQuantities(existing.movDevTransferencias));

        await tx.iDevTransferencias.create({
          data: {
            Numero: existing.Numero,
            CodigoEnvia: existing.CodigoEnvia,
            CodigoRecibe: existing.CodigoRecibe,
            Fecha: existing.Fecha,
            FechaEmision: existing.FechaEmision ?? new Date(),
            TotalValor: existing.TotalValor,
            Observacion: existing.Observacion || "",
            Status: 1,
            Usuario: user.codUsuario,
            InterContable: existing.InterContable ?? 0,
            IDLote: existing.IDLote,
          },
        });

        await tx.iMovDevTransferencias.createMany({
          data: existing.movDevTransferencias.map((line) => ({
            Numero: existing.Numero,
            CodigoEnvia: existing.CodigoEnvia,
            Item: line.Item,
            Fecha: line.Fecha,
            CodigoBarra: line.CodigoBarra,
            Cantidad: line.Cantidad,
            Valor: line.Valor,
            NumeroCaja: line.NumeroCaja,
            UltimoCosto: line.UltimoCosto,
            CostoInicial: line.CostoInicial,
            CostoDolar: line.CostoDolar,
          })),
        });

        await tx.devTransferencias.update({
          where: { Numero: existing.Numero },
          data: { Status: 1 },
        });

        await tx.devBorrador.updateMany({
          where: { Numero: BigInt(existing.Numero) },
          data: { Status: 3 },
        });

        return tx.devTransferencias.findUniqueOrThrow({
          where: { Numero: existing.Numero },
          include: {
            movDevTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
              include: { inventarioRef: true },
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      devolucion: this.toReturnView(devolucion),
    };
  }

  private async findDraftOrThrow(
    client: PrismaService | DevReturnTransactionClient,
    numero: bigint,
  ): Promise<DevDraftWithRelations> {
    const draft = await client.devBorrador.findUnique({
      where: { Numero: numero },
      include: devDraftInclude,
    });

    if (!draft) {
      throw new NotFoundException("El borrador de devolucion no existe.");
    }

    return draft;
  }

  private async getNextDraftNumber(tx: DevReturnTransactionClient) {
    const result = await tx.devBorrador.aggregate({
      _max: { Numero: true },
    });

    return (result._max.Numero ?? BigInt(0)) + BigInt(1);
  }

  private async normalizeDraftLines(tx: DevReturnTransactionClient, items: CreateDevDraftLineDto[]) {
    const meaningfulItems = items.filter((item) => String(item.codigoBarra || "").trim());
    const codes = [...new Set(meaningfulItems.map((item) => item.codigoBarra))];
    const articles = await tx.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
    });
    const articlesByCode = new Map(articles.map((article) => [article.CodigoBarra, article]));

    return meaningfulItems.map((item, index): NormalizedDevDraftLine => {
      const articulo = articlesByCode.get(item.codigoBarra);
      if (!articulo) {
        throw new NotFoundException(`No se encontro el articulo ${item.codigoBarra} en inventario.`);
      }

      const cantidad = new Prisma.Decimal(item.cantidad || "0");
      if (cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`La cantidad del articulo ${item.codigoBarra} debe ser mayor a cero.`);
      }

      return {
        item: index + 1,
        codigoBarra: item.codigoBarra,
        cantidad,
        numeroCaja: item.numeroCaja ?? 0,
        costo: new Prisma.Decimal(item.costo || articulo.UltimoCosto || articulo.CostoInicial || ZERO),
        articulo,
      };
    });
  }

  private async ensureReturnReferences(tx: DevReturnTransactionClient, dto: ApproveDevReturnDto) {
    if (dto.codigoEnvia === dto.codigoRecibe) {
      throw new BadRequestException("El origen y el destino no pueden ser iguales.");
    }

    const [origin, destination, lote] = await Promise.all([
      tx.sucursales.findUnique({ where: { Codigo: dto.codigoEnvia } }),
      tx.sucursales.findUnique({ where: { Codigo: dto.codigoRecibe } }),
      tx.lotes.findUnique({ where: { ID: dto.idLote } }),
    ]);

    if (!origin) {
      throw new BadRequestException("La sucursal que envia no existe.");
    }
    if (!destination) {
      throw new BadRequestException("La sucursal que recibe no existe.");
    }
    if (!lote) {
      throw new BadRequestException("El lote indicado no existe.");
    }
  }

  private calculateDraftTotal(lines: Array<{ Cantidad: Prisma.Decimal; Costo: Prisma.Decimal }>) {
    return lines.reduce((total, line) => total.plus(line.Cantidad.mul(line.Costo)), ZERO);
  }

  private aggregateDraftQuantities(lines: Array<{ CodigoBarra: string; Cantidad: Prisma.Decimal }>) {
    const positive = new Map<string, Prisma.Decimal>();
    const negated = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      const current = positive.get(line.CodigoBarra) ?? ZERO;
      positive.set(line.CodigoBarra, current.plus(line.Cantidad));
      negated.set(line.CodigoBarra, (negated.get(line.CodigoBarra) ?? ZERO).minus(line.Cantidad));
    }

    return { positive, negated };
  }

  private aggregateReturnQuantities(lines: Array<{ CodigoBarra: string; Cantidad: Prisma.Decimal }>) {
    const values = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      values.set(line.CodigoBarra, (values.get(line.CodigoBarra) ?? ZERO).plus(line.Cantidad));
    }

    return values;
  }

  private async applyInventoryDelta(tx: DevReturnTransactionClient, values: Map<string, Prisma.Decimal>) {
    const codes = Array.from(values.keys());
    if (codes.length === 0) {
      return;
    }

    const articles = await tx.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
    });
    const articlesByCode = new Map(articles.map((article) => [article.CodigoBarra, article]));
    const now = new Date();

    for (const [codigoBarra, delta] of values.entries()) {
      const article = articlesByCode.get(codigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} en inventario.`);
      }

      const nextExistence = article.Existencia.plus(delta);
      if (nextExistence.lessThan(0)) {
        throw new BadRequestException(
          `El articulo ${codigoBarra} no tiene existencia suficiente. Disponible: ${article.Existencia.toString()}, solicitado: ${delta.abs().toString()}.`,
        );
      }

      await tx.inventario.update({
        where: { CodigoBarra: codigoBarra },
        data: {
          Existencia: nextExistence,
          UltimaActualizacion: now,
          FechaPrimerMovimiento: article.FechaPrimerMovimiento ?? now,
        },
      });
    }
  }

  private toDraftView(item: DevDraftWithRelations) {
    return {
      numero: item.Numero.toString(),
      fecha: item.Fecha,
      observacion: item.Observacion,
      usuario: item.Usuario,
      usuarioNombre: item.usuarioRef?.NombreUsuario ?? null,
      status: item.Status,
      totalValor: this.calculateDraftTotal(item.movimientos).toString(),
      items: item.movimientos.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        numeroCaja: line.NumeroCaja,
        costo: line.Costo.toString(),
        articulo: {
          codigoBarra: line.inventarioRef.CodigoBarra,
          nombre: line.inventarioRef.Nombre,
          referencia: line.inventarioRef.Referencia,
          existenciaActual: line.inventarioRef.Existencia.toString(),
        },
      })),
    };
  }

  private toReturnView(
    item: Prisma.DevTransferenciasGetPayload<{
      include: {
        movDevTransferencias: {
          include: { inventarioRef: true };
        };
      };
    }>,
  ) {
    return {
      numero: item.Numero,
      fecha: item.Fecha,
      codigoEnvia: item.CodigoEnvia,
      codigoRecibe: item.CodigoRecibe,
      codigoOrigen: item.DocumentoOrigen,
      totalValor: item.TotalValor.toString(),
      observacion: item.Observacion,
      status: item.Status,
      usuario: item.Usuario,
      fechaEmision: item.FechaEmision,
      interContable: item.InterContable,
      idLote: item.IDLote,
      items: item.movDevTransferencias.map((line) => ({
        item: line.Item,
        fecha: line.Fecha,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
        numeroCaja: line.NumeroCaja,
        ultimoCosto: line.UltimoCosto?.toString() ?? null,
        costoInicial: line.CostoInicial?.toString() ?? null,
        costoDolar: line.CostoDolar?.toString() ?? null,
      })),
    };
  }
}

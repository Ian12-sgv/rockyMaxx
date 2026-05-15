import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Ajustes, type Inventario } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { UserView } from "../users/user-view.util";
import { CreateAdjustmentDto, CreateAdjustmentLineDto } from "./dto/create-adjustment.dto";
import { FindAdjustmentsDto } from "./dto/find-adjustments.dto";

const ZERO = new Prisma.Decimal(0);
const DEFAULT_ADJUSTMENT_LOT = "S/DEFINIR";
const DEFAULT_ADJUSTMENT_LOT_DESCRIPTION = "Sin definir";

type AdjustmentTransactionClient = Prisma.TransactionClient;

type NormalizedAdjustmentLine = {
  codigoBarra: string;
  cantidad: Prisma.Decimal;
  costo: Prisma.Decimal;
  articulo: Inventario;
};

type AdjustmentMovementRow = {
  Numero: bigint;
  CodigoBarra: string;
  Cantidad: Prisma.Decimal;
  Costo: Prisma.Decimal;
  Referencia?: string | null;
  Nombre?: string | null;
  Existencia?: Prisma.Decimal | null;
};

@Injectable()
export class AdjustmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata(user: UserView) {
    const defaultLotId = await this.resolveAdjustmentLotId(this.prisma, undefined, user.codUsuario);
    const lotes = await this.prisma.lotes.findMany({
      orderBy: { ID: "asc" },
    });

    return {
      defaults: {
        fecha: new Date(),
        status: 0,
        idLote: defaultLotId,
        tipo: "positivo",
        tipoAjuste: 1,
      },
      tiposAjuste: [
        {
          tipo: "positivo",
          tipoAjuste: 1,
          signo: 1,
          descripcion: "POSITIVO - SUMA",
        },
        {
          tipo: "negativo",
          tipoAjuste: 2,
          signo: -1,
          descripcion: "NEGATIVO - RESTA",
        },
      ],
      lotes: lotes.map((item) => ({
        id: item.ID,
        lote: item.Lote,
        descripcion: item.Descripcion,
        estado: item.Estado,
      })),
    };
  }

  async searchAdjustments(findAdjustmentsDto: FindAdjustmentsDto) {
    const limit = findAdjustmentsDto.limit ?? 25;
    const signo = this.resolveSign(findAdjustmentsDto.tipo);
    const buscar = String(findAdjustmentsDto.buscar || "").trim();

    const items = await this.prisma.ajustes.findMany({
      where: {
        ...(signo ? { Signo: signo } : {}),
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
      orderBy: { Numero: "desc" },
      take: limit,
    });

    return {
      items: items.map((item) => this.toAdjustmentView(item, [])),
    };
  }

  async findOne(numero: bigint) {
    const adjustment = await this.findAdjustmentOrThrow(numero);
    const movements = await this.loadMovements(numero);

    return {
      ajuste: this.toAdjustmentView(adjustment, movements),
    };
  }

  async createAdjustment(createAdjustmentDto: CreateAdjustmentDto, user: UserView) {
    const ajuste = await this.prisma.$transaction(
      async (tx) => {
        const signo = this.resolveRequiredSign(createAdjustmentDto.tipo);
        const numero = await this.getNextAdjustmentNumber(tx);
        const lines = await this.normalizeLines(tx, createAdjustmentDto.items || []);

        if (lines.length === 0) {
          throw new BadRequestException("El ajuste debe tener al menos un renglon.");
        }

        const idLote = await this.resolveAdjustmentLotId(tx, createAdjustmentDto.idLote, user.codUsuario);

        const totalValor = lines.reduce((total, line) => total.plus(line.cantidad.mul(line.costo)), ZERO);
        const tipoAjuste = createAdjustmentDto.tipoAjuste ?? (signo === 1 ? 1 : 2);
        const fecha = createAdjustmentDto.fecha ?? new Date();

        await tx.ajustes.create({
          data: {
            Numero: numero,
            TipoAjuste: tipoAjuste,
            Signo: signo,
            Fecha: fecha,
            TotalValor: totalValor,
            Observacion: String(createAdjustmentDto.observacion || "").trim(),
            Usuario: user.codUsuario,
            InterContable: createAdjustmentDto.interContable ?? 0,
            Status: 0,
            IDLote: idLote,
          },
        });

        await this.insertMovementRows(tx, numero, lines);

        return tx.ajustes.findUniqueOrThrow({
          where: { Numero: numero },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      ajuste: this.toAdjustmentView(ajuste, await this.loadMovements(ajuste.Numero)),
    };
  }

  async updateAdjustment(numero: bigint, updateAdjustmentDto: CreateAdjustmentDto, user: UserView) {
    const ajuste = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.ajustes.findUnique({
          where: { Numero: numero },
        });

        if (!existing) {
          throw new NotFoundException("El ajuste no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("El ajuste ya fue aprobado y no puede editarse.");
        }

        const signo = this.resolveRequiredSign(updateAdjustmentDto.tipo);
        const lines = await this.normalizeLines(tx, updateAdjustmentDto.items || []);

        if (lines.length === 0) {
          throw new BadRequestException("El ajuste debe tener al menos un renglon.");
        }

        const idLote = await this.resolveAdjustmentLotId(tx, updateAdjustmentDto.idLote ?? existing.IDLote, user.codUsuario);
        const totalValor = lines.reduce((total, line) => total.plus(line.cantidad.mul(line.costo)), ZERO);
        const tipoAjuste = updateAdjustmentDto.tipoAjuste ?? (signo === 1 ? 1 : 2);
        const fecha = updateAdjustmentDto.fecha ?? existing.Fecha;

        await this.deleteMovementRows(tx, numero);

        await tx.ajustes.update({
          where: { Numero: numero },
          data: {
            TipoAjuste: tipoAjuste,
            Signo: signo,
            Fecha: fecha,
            TotalValor: totalValor,
            Observacion: String(updateAdjustmentDto.observacion || "").trim(),
            Usuario: user.codUsuario,
            InterContable: updateAdjustmentDto.interContable ?? existing.InterContable,
            IDLote: idLote,
          },
        });

        await this.insertMovementRows(tx, numero, lines);

        return tx.ajustes.findUniqueOrThrow({
          where: { Numero: numero },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      ajuste: this.toAdjustmentView(ajuste, await this.loadMovements(ajuste.Numero)),
    };
  }

  async approveAdjustment(numero: bigint) {
    const ajuste = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.ajustes.findUnique({
          where: { Numero: numero },
        });

        if (!existing) {
          throw new NotFoundException("El ajuste no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("El ajuste ya fue aprobado.");
        }

        const movementRows = await this.loadMovements(numero, tx);
        const lines = await this.normalizeStoredMovementLines(tx, movementRows);

        if (lines.length === 0) {
          throw new BadRequestException("El ajuste debe tener al menos un renglon para aprobar.");
        }

        const signo = this.resolveRequiredSign(existing.Signo);
        await this.applyInventoryAdjustment(tx, lines, signo);

        const totalValor = lines.reduce((total, line) => total.plus(line.cantidad.mul(line.costo)), ZERO);

        return tx.ajustes.update({
          where: { Numero: numero },
          data: {
            Status: 1,
            TotalValor: totalValor,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      ajuste: this.toAdjustmentView(ajuste, await this.loadMovements(ajuste.Numero)),
    };
  }

  private async findAdjustmentOrThrow(numero: bigint) {
    const adjustment = await this.prisma.ajustes.findUnique({
      where: { Numero: numero },
    });

    if (!adjustment) {
      throw new NotFoundException("El ajuste no existe.");
    }

    return adjustment;
  }

  private async getNextAdjustmentNumber(tx: AdjustmentTransactionClient) {
    const result = await tx.ajustes.aggregate({
      _max: { Numero: true },
    });

    return (result._max.Numero ?? BigInt(0)) + BigInt(1);
  }

  private async normalizeLines(tx: AdjustmentTransactionClient, items: CreateAdjustmentLineDto[]) {
    const grouped = new Map<string, { codigoBarra: string; cantidad: Prisma.Decimal; costo?: string }>();

    for (const item of items) {
      const codigoBarra = String(item.codigoBarra || "").trim().toUpperCase();
      if (!codigoBarra) {
        continue;
      }

      const cantidad = new Prisma.Decimal(item.cantidad || "0");
      if (cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`La cantidad del articulo ${codigoBarra} debe ser mayor a cero.`);
      }

      const current = grouped.get(codigoBarra);
      grouped.set(codigoBarra, {
        codigoBarra,
        cantidad: (current?.cantidad ?? ZERO).plus(cantidad),
        costo: item.costo ?? current?.costo,
      });
    }

    const codes = [...new Set(Array.from(grouped.values()).map((item) => item.codigoBarra))];
    if (codes.length === 0) {
      return [];
    }

    const articles = await tx.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
    });
    const articlesByCode = new Map(articles.map((article) => [article.CodigoBarra, article]));

    return Array.from(grouped.values()).map((value): NormalizedAdjustmentLine => {
      const article = articlesByCode.get(value.codigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${value.codigoBarra} en inventario.`);
      }

      return {
        codigoBarra: value.codigoBarra,
        cantidad: value.cantidad,
        costo: new Prisma.Decimal(value.costo || article.UltimoCosto || article.CostoInicial || ZERO),
        articulo: article,
      };
    });
  }

  private async normalizeStoredMovementLines(
    tx: AdjustmentTransactionClient,
    movements: AdjustmentMovementRow[],
  ) {
    const codes = [...new Set(movements.map((item) => item.CodigoBarra))];
    if (codes.length === 0) {
      return [];
    }

    const articles = await tx.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
    });
    const articlesByCode = new Map(articles.map((article) => [article.CodigoBarra, article]));

    return movements.map((line): NormalizedAdjustmentLine => {
      const article = articlesByCode.get(line.CodigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${line.CodigoBarra} en inventario.`);
      }

      return {
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad,
        costo: line.Costo,
        articulo: article,
      };
    });
  }

  private async ensureLotExists(tx: AdjustmentTransactionClient | PrismaService, idLote: number) {
    const lote = await tx.lotes.findUnique({
      where: { ID: idLote },
    });

    if (!lote) {
      throw new BadRequestException("El lote indicado no existe.");
    }
  }

  private async resolveAdjustmentLotId(
    tx: AdjustmentTransactionClient | PrismaService,
    requestedId: number | undefined,
    userCode: string,
  ) {
    if (typeof requestedId === "number") {
      await this.ensureLotExists(tx, requestedId);
      return requestedId;
    }

    const existing = await tx.lotes.findUnique({
      where: { Lote: DEFAULT_ADJUSTMENT_LOT },
    });

    if (existing) {
      return existing.ID;
    }

    const nextLotId = await this.getNextLotId(tx);

    try {
      const created = await tx.lotes.create({
        data: {
          ID: nextLotId,
          Lote: DEFAULT_ADJUSTMENT_LOT,
          Descripcion: DEFAULT_ADJUSTMENT_LOT_DESCRIPTION,
          Estado: 1,
          FechaRegistro: new Date(),
          UsuarioCreacion: userCode,
        },
      });

      return created.ID;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        const lot = await tx.lotes.findUnique({
          where: { Lote: DEFAULT_ADJUSTMENT_LOT },
        });

        if (lot) {
          return lot.ID;
        }
      }

      throw error;
    }
  }

  private async getNextLotId(tx: AdjustmentTransactionClient | PrismaService) {
    const result = await tx.lotes.aggregate({
      _max: {
        ID: true,
      },
    });

    return (result._max.ID ?? 0) + 1;
  }

  private async applyInventoryAdjustment(
    tx: AdjustmentTransactionClient,
    lines: NormalizedAdjustmentLine[],
    signo: 1 | -1,
  ) {
    const now = new Date();

    for (const line of lines) {
      const delta = line.cantidad.mul(signo);
      const nextExistence = line.articulo.Existencia.plus(delta);

      if (nextExistence.lessThan(0)) {
        throw new BadRequestException(
          `El articulo ${line.codigoBarra} no tiene existencia suficiente. Disponible: ${line.articulo.Existencia.toString()}, ajuste: ${line.cantidad.toString()}.`,
        );
      }

      await tx.inventario.update({
        where: { CodigoBarra: line.codigoBarra },
        data: {
          Existencia: nextExistence,
          UltimaActualizacion: now,
          FechaPrimerMovimiento: line.articulo.FechaPrimerMovimiento ?? now,
        },
      });
    }
  }

  private async insertMovementRows(
    tx: AdjustmentTransactionClient,
    numero: bigint,
    lines: NormalizedAdjustmentLine[],
  ) {
    for (const line of lines) {
      await tx.$executeRaw`
        insert into dbo."MOVAJUSTES" ("Numero", "CodigoBarra", "Cantidad", "Costo")
        values (${numero}, ${line.codigoBarra}, ${line.cantidad}, ${line.costo})
      `;
    }
  }

  private async deleteMovementRows(tx: AdjustmentTransactionClient, numero: bigint) {
    await tx.$executeRaw`
      delete from dbo."MOVAJUSTES"
      where "Numero" = ${numero}
    `;
  }

  private async loadMovements(
    numero: bigint,
    client: PrismaService | AdjustmentTransactionClient = this.prisma,
  ) {
    return client.$queryRaw<AdjustmentMovementRow[]>`
      select
        m."Numero",
        m."CodigoBarra",
        m."Cantidad",
        m."Costo",
        i."Referencia",
        i."Nombre",
        i."Existencia"
      from dbo."MOVAJUSTES" m
      left join dbo."INVENTARIO" i on i."CodigoBarra" = m."CodigoBarra"
      where m."Numero" = ${numero}
      order by m."CodigoBarra"
    `;
  }

  private resolveRequiredSign(value: FindAdjustmentsDto["tipo"] | CreateAdjustmentDto["tipo"] | number | undefined): 1 | -1 {
    const signo = this.resolveSign(value);
    if (!signo) {
      throw new BadRequestException("El tipo de ajuste debe ser positivo o negativo.");
    }

    return signo;
  }

  private resolveSign(value: FindAdjustmentsDto["tipo"] | CreateAdjustmentDto["tipo"] | number | undefined) {
    if (value === "positivo" || value === 1 || value === "1") {
      return 1;
    }
    if (value === "negativo" || value === -1 || value === "-1") {
      return -1;
    }

    return null;
  }

  private toAdjustmentView(item: Ajustes, movements: AdjustmentMovementRow[]) {
    return {
      numero: item.Numero.toString(),
      tipoAjuste: item.TipoAjuste,
      signo: item.Signo,
      tipo: item.Signo === 1 ? "positivo" : "negativo",
      fecha: item.Fecha,
      totalValor: item.TotalValor.toString(),
      observacion: item.Observacion,
      usuario: item.Usuario,
      interContable: item.InterContable,
      status: item.Status,
      idLote: item.IDLote,
      items: movements.map((line) => ({
        codigoBarra: line.CodigoBarra,
        referencia: line.Referencia || "",
        nombre: line.Nombre || "",
        cantidad: line.Cantidad.toString(),
        costo: line.Costo.toString(),
        existenciaActual: line.Existencia?.toString() || "",
      })),
    };
  }
}

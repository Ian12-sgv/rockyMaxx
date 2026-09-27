import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma-client";

import { PrismaService } from "../prisma/prisma.service";

export type CrearMovimientoInput = {
  tipo: "ingreso" | "egreso";
  moneda: "BS" | "USD";
  esOperativo: boolean;
  monto: number;
  descripcion: string;
  fecha: string;
  codigosTienda: string[];
  registradoPor?: string;
};

export type ActualizarMovimientoInput = {
  moneda: "BS" | "USD";
  esOperativo: boolean;
  monto: number;
  descripcion: string;
  fecha: string;
  codigosTienda: string[];
  registradoPor?: string;
};

@Injectable()
export class BalanceService {
  constructor(private readonly prisma: PrismaService) {}

  // soloGrupoB: usuario del grupo B (tiendas con "rocky" en el nombre, mismo
  // criterio que ValidacionesService). Solo recibe movimientos que incluyan
  // alguna tienda suya, y de cada uno solo ve los codigos de SUS tiendas (no
  // se le revela a que tiendas del grupo A tambien se asigno).
  async listarMovimientos(desde: string, hasta: string, codigoTienda?: string, soloGrupoB = false) {
    const esGrupoB = (nombre: string | null | undefined) => /rocky/i.test(String(nombre || ""));
    const rows = await this.prisma.balanceMovimiento.findMany({
      where: {
        fecha: { gte: new Date(`${desde}T00:00:00Z`), lte: new Date(`${hasta}T00:00:00Z`) },
        AND: [
          codigoTienda ? { tiendas: { some: { dimTienda: { codigoLegacy: codigoTienda } } } } : {},
          soloGrupoB ? { tiendas: { some: { dimTienda: { nombre: { contains: "rocky", mode: "insensitive" } } } } } : {},
        ],
      },
      include: { tiendas: { include: { dimTienda: true } } },
      orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      moneda: row.moneda,
      es_operativo: row.esOperativo,
      monto: row.monto.toString(),
      descripcion: row.descripcion,
      fecha: row.fecha.toISOString().slice(0, 10),
      registrado_por: row.registradoPor,
      codigos_tienda: row.tiendas
        .filter((t) => !soloGrupoB || esGrupoB(t.dimTienda.nombre))
        .map((t) => t.dimTienda.codigoLegacy),
    }));
  }

  async crearMovimiento(input: CrearMovimientoInput) {
    if (input.tipo !== "ingreso" && input.tipo !== "egreso") {
      throw new BadRequestException('"tipo" debe ser "ingreso" o "egreso".');
    }
    this.validarCamposComunes(input);
    const tiendas = await this.resolverTiendas(input.codigosTienda);

    const creado = await this.prisma.balanceMovimiento.create({
      data: {
        tipo: input.tipo,
        moneda: input.moneda,
        esOperativo: Boolean(input.esOperativo),
        monto: new Prisma.Decimal(input.monto),
        descripcion: input.descripcion.trim(),
        fecha: new Date(`${input.fecha}T00:00:00Z`),
        registradoPor: input.registradoPor?.trim() || null,
        tiendas: {
          create: tiendas.map((t) => ({ dimTiendaId: t.id })),
        },
      },
    });

    return { id: creado.id };
  }

  async actualizarMovimiento(id: string, input: ActualizarMovimientoInput) {
    const existe = await this.prisma.balanceMovimiento.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException("Movimiento no encontrado.");
    }
    this.validarCamposComunes(input);
    const tiendas = await this.resolverTiendas(input.codigosTienda);

    await this.prisma.$transaction([
      this.prisma.balanceMovimientoTienda.deleteMany({ where: { movimientoId: id } }),
      this.prisma.balanceMovimiento.update({
        where: { id },
        data: {
          moneda: input.moneda,
          esOperativo: Boolean(input.esOperativo),
          monto: new Prisma.Decimal(input.monto),
          descripcion: input.descripcion.trim(),
          fecha: new Date(`${input.fecha}T00:00:00Z`),
          registradoPor: input.registradoPor?.trim() || null,
          tiendas: {
            create: tiendas.map((t) => ({ dimTiendaId: t.id })),
          },
        },
      }),
    ]);

    return { ok: true };
  }

  async eliminarMovimiento(id: string) {
    const existe = await this.prisma.balanceMovimiento.findUnique({ where: { id } });
    if (!existe) {
      throw new NotFoundException("Movimiento no encontrado.");
    }
    await this.prisma.balanceMovimiento.delete({ where: { id } });
    return { ok: true };
  }

  private validarCamposComunes(input: { moneda: string; monto: number; descripcion: string; codigosTienda: string[] }) {
    if (input.moneda !== "BS" && input.moneda !== "USD") {
      throw new BadRequestException('"moneda" debe ser "BS" o "USD".');
    }
    if (!Number.isFinite(input.monto) || input.monto <= 0) {
      throw new BadRequestException('"monto" debe ser un numero mayor a 0.');
    }
    if (!input.descripcion || !input.descripcion.trim()) {
      throw new BadRequestException('"descripcion" es requerida.');
    }
    if (!Array.isArray(input.codigosTienda) || input.codigosTienda.length === 0) {
      throw new BadRequestException('"codigosTienda" debe tener al menos una tienda.');
    }
  }

  private async resolverTiendas(codigosTienda: string[]) {
    const codigos = [...new Set(codigosTienda.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    const tiendas = await this.prisma.dimTiendas.findMany({
      where: { codigoLegacy: { in: codigos } },
    });
    if (tiendas.length !== codigos.length) {
      const encontrados = new Set(tiendas.map((t) => t.codigoLegacy));
      const faltantes = codigos.filter((c) => !encontrados.has(c));
      throw new BadRequestException(`Tienda(s) no encontrada(s): ${faltantes.join(", ")}`);
    }
    return tiendas;
  }
}

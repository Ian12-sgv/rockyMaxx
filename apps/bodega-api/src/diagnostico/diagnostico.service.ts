import { Injectable } from "@nestjs/common";

import { Prisma } from "../../generated/prisma-client";
import { DimTiendasService } from "../dim-tiendas/dim-tiendas.service";
import { PrismaService } from "../prisma/prisma.service";

type DiagnosticoPayload = {
  generadoEn?: string;
  subsistemas?: Record<string, unknown>;
};

@Injectable()
export class DiagnosticoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dimTiendasService: DimTiendasService,
  ) {}

  async guardar(codigoTiendaRaw: string, payload: DiagnosticoPayload) {
    const tienda = await this.dimTiendasService.requireActiveByCodigo(codigoTiendaRaw);
    const diagnosticoJson = (payload ?? {}) as Prisma.InputJsonValue;
    const actualizadoEn = new Date();

    await this.prisma.nodoDiagnostico.upsert({
      where: { dimTiendaId: tienda.id },
      create: { dimTiendaId: tienda.id, diagnosticoJson, actualizadoEn },
      update: { diagnosticoJson, actualizadoEn },
    });

    return { ok: true };
  }

  async listar() {
    const filas = await this.prisma.nodoDiagnostico.findMany({
      include: { dimTienda: true },
    });

    return filas
      .map((fila) => ({
        codigoTienda: fila.dimTienda.codigoLegacy,
        nombreTienda: fila.dimTienda.nombre,
        actualizadoEn: fila.actualizadoEn,
        diagnostico: fila.diagnosticoJson,
      }))
      .sort((a, b) => a.codigoTienda.localeCompare(b.codigoTienda));
  }

  async obtener(codigoTiendaRaw: string) {
    const tienda = await this.dimTiendasService.requireActiveByCodigo(codigoTiendaRaw);
    const fila = await this.prisma.nodoDiagnostico.findUnique({ where: { dimTiendaId: tienda.id } });

    if (!fila) {
      return { codigoTienda: tienda.codigoLegacy, actualizadoEn: null, diagnostico: null };
    }

    return { codigoTienda: tienda.codigoLegacy, actualizadoEn: fila.actualizadoEn, diagnostico: fila.diagnosticoJson };
  }
}

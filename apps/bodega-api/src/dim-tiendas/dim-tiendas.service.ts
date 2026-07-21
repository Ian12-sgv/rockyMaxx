import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DimTiendasService {
  constructor(private readonly prisma: PrismaService) {}

  async requireActiveByCodigo(codigoLegacyRaw: string) {
    const codigoLegacy = String(codigoLegacyRaw || "").trim().toUpperCase();

    if (!codigoLegacy) {
      throw new NotFoundException("codigoTienda invalido.");
    }

    const tienda = await this.prisma.dimTiendas.findUnique({
      where: { codigoLegacy },
    });

    if (!tienda) {
      throw new NotFoundException(`No existe la tienda "${codigoLegacy}" en DIM_TIENDAS.`);
    }

    if (!tienda.activa) {
      throw new ForbiddenException(`La tienda "${codigoLegacy}" existe pero no esta activa.`);
    }

    return tienda;
  }

  async list() {
    return this.prisma.dimTiendas.findMany({ orderBy: { codigoLegacy: "asc" } });
  }
}

import { Injectable } from "@nestjs/common";

import { EntidadDestino } from "../shared/entidades";
import { PrismaService } from "../prisma/prisma.service";

// Cursor de lectura por dim_tienda_id + entidad_destino. Solo optimiza que
// el extractor no tenga que re-escanear todo cada minuto: la verdad de
// cambio SIEMPRE es hash_registro en las tablas *_HIST (ver EtlWatermarks en
// prisma/schema.prisma). last_hash es metadata informativa, no se usa para
// decidir idempotencia.
@Injectable()
export class EtlWatermarksService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(params: {
    dimTiendaId: string;
    codigoTiendaLegacy: string;
    entidadDestino: EntidadDestino;
    tablaOrigen: string;
    lastPkOrigen: string;
    lastUpdatedAt: Date;
    lastHash: string;
  }) {
    await this.prisma.etlWatermarks.upsert({
      where: {
        dimTiendaId_entidadDestino: {
          dimTiendaId: params.dimTiendaId,
          entidadDestino: params.entidadDestino,
        },
      },
      update: {
        tablaOrigen: params.tablaOrigen,
        lastPkOrigen: params.lastPkOrigen,
        lastUpdatedAt: params.lastUpdatedAt,
        lastHash: params.lastHash,
      },
      create: {
        dimTiendaId: params.dimTiendaId,
        codigoTiendaLegacy: params.codigoTiendaLegacy,
        entidadDestino: params.entidadDestino,
        tablaOrigen: params.tablaOrigen,
        lastPkOrigen: params.lastPkOrigen,
        lastUpdatedAt: params.lastUpdatedAt,
        lastHash: params.lastHash,
      },
    });
  }
}

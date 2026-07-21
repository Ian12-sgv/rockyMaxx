import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma-client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class EtlSyncErrorsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    syncRunId: string;
    dimTiendaId: string;
    codigoTiendaLegacy: string;
    tablaOrigen: string;
    pkOrigen: string | null;
    errorMessage: string;
    payload: Record<string, unknown> | null;
  }) {
    await this.prisma.etlSyncErrors.create({
      data: {
        syncRunId: params.syncRunId,
        dimTiendaId: params.dimTiendaId,
        codigoTiendaLegacy: params.codigoTiendaLegacy,
        tablaOrigen: params.tablaOrigen,
        pkOrigen: params.pkOrigen,
        errorMessage: params.errorMessage,
        payloadJson: params.payload === null ? Prisma.JsonNull : (params.payload as Prisma.InputJsonValue),
      },
    });
  }
}

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

export type SyncRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type SyncRunCounters = {
  registrosLeidos: number;
  registrosInsertados: number;
  registrosActualizados: number;
  registrosOmitidos: number;
  errorCount: number;
};

@Injectable()
export class EtlSyncRunsService {
  constructor(private readonly prisma: PrismaService) {}

  async startRun(dimTiendaId: string, codigoTiendaLegacy: string) {
    return this.prisma.etlSyncRuns.create({
      data: {
        dimTiendaId,
        codigoTiendaLegacy,
        status: "RUNNING",
      },
    });
  }

  async finishRun(
    runId: string,
    params: SyncRunCounters & { status: SyncRunStatus; tablasProcesadas: string[] },
  ) {
    return this.prisma.etlSyncRuns.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        status: params.status,
        tablasProcesadas: params.tablasProcesadas,
        registrosLeidos: params.registrosLeidos,
        registrosInsertados: params.registrosInsertados,
        registrosActualizados: params.registrosActualizados,
        registrosOmitidos: params.registrosOmitidos,
        errorCount: params.errorCount,
      },
    });
  }
}

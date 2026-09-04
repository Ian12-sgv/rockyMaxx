import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "../../generated/prisma-client";

import { DimTiendasService } from "../dim-tiendas/dim-tiendas.service";
import { EtlSyncErrorsService } from "../etl/etl-sync-errors.service";
import { EtlSyncRunsService, SyncRunStatus } from "../etl/etl-sync-runs.service";
import { EtlWatermarksService } from "../etl/etl-watermarks.service";
import { PrismaService } from "../prisma/prisma.service";
import { computeHashRegistro } from "../shared/hash-registro.util";
import { EntidadDestino, ENTIDAD_TABLA_ORIGEN } from "../shared/entidades";
import { IngestRegistroDto, IngestRequestDto, IngestTablaBatchDto } from "./dto/ingest-request.dto";

type HistDelegate = {
  findFirst(args: unknown): Promise<{ id: string; hashRegistro: string } | null>;
  update(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
};

type TransactionClient = Prisma.TransactionClient;

type UpsertOutcome = "SKIPPED" | "INSERTED" | "UPDATED";

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dimTiendasService: DimTiendasService,
    private readonly syncRunsService: EtlSyncRunsService,
    private readonly syncErrorsService: EtlSyncErrorsService,
    private readonly watermarksService: EtlWatermarksService,
  ) {}

  async processIngest(codigoTiendaRaw: string, dto: IngestRequestDto) {
    const tienda = await this.dimTiendasService.requireActiveByCodigo(codigoTiendaRaw);
    const run = await this.syncRunsService.startRun(tienda.id, tienda.codigoLegacy);

    const counters = {
      registrosLeidos: 0,
      registrosInsertados: 0,
      registrosActualizados: 0,
      registrosOmitidos: 0,
      errorCount: 0,
    };
    const tablasProcesadas: string[] = [];
    const watermarkCandidates = new Map<
      EntidadDestino,
      { pkOrigen: string; fechaExtraida: Date; hash: string }
    >();

    for (const tablaBatch of dto.tablas) {
      const entidadDestino = tablaBatch.entidadDestino as EntidadDestino;
      tablasProcesadas.push(entidadDestino);

      const tablaOrigenEsperada = ENTIDAD_TABLA_ORIGEN[entidadDestino];
      if (tablaBatch.tablaOrigen !== tablaOrigenEsperada) {
        counters.errorCount += 1;
        await this.syncErrorsService.record({
          syncRunId: run.id,
          dimTiendaId: tienda.id,
          codigoTiendaLegacy: tienda.codigoLegacy,
          tablaOrigen: tablaBatch.tablaOrigen,
          pkOrigen: null,
          errorMessage: `tablaOrigen "${tablaBatch.tablaOrigen}" no corresponde a entidadDestino "${entidadDestino}" (se esperaba "${tablaOrigenEsperada}"). Lote completo omitido.`,
          payload: null,
        });
        continue;
      }

      for (const registro of tablaBatch.registros) {
        counters.registrosLeidos += 1;

        try {
          const { outcome, hash } = await this.upsertHistRecord({
            tienda,
            runId: run.id,
            entidadDestino,
            tablaOrigen: tablaBatch.tablaOrigen,
            registro,
          });

          if (outcome === "SKIPPED") counters.registrosOmitidos += 1;
          else if (outcome === "INSERTED") counters.registrosInsertados += 1;
          else counters.registrosActualizados += 1;

          const fechaExtraida = new Date(registro.fechaExtraida);
          const previous = watermarkCandidates.get(entidadDestino);
          if (!previous || fechaExtraida >= previous.fechaExtraida) {
            watermarkCandidates.set(entidadDestino, { pkOrigen: registro.pkOrigen, fechaExtraida, hash });
          }
        } catch (error) {
          counters.errorCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Error procesando ${entidadDestino}/${registro.pkOrigen} para tienda ${tienda.codigoLegacy}: ${message}`,
          );
          await this.syncErrorsService.record({
            syncRunId: run.id,
            dimTiendaId: tienda.id,
            codigoTiendaLegacy: tienda.codigoLegacy,
            tablaOrigen: tablaBatch.tablaOrigen,
            pkOrigen: registro.pkOrigen,
            errorMessage: message,
            payload: registro.payload,
          });
        }
      }
    }

    for (const [entidadDestino, candidate] of watermarkCandidates) {
      await this.watermarksService.upsert({
        dimTiendaId: tienda.id,
        codigoTiendaLegacy: tienda.codigoLegacy,
        entidadDestino,
        tablaOrigen: ENTIDAD_TABLA_ORIGEN[entidadDestino],
        lastPkOrigen: candidate.pkOrigen,
        lastUpdatedAt: candidate.fechaExtraida,
        lastHash: candidate.hash,
      });
    }

    const procesados =
      counters.registrosInsertados + counters.registrosActualizados + counters.registrosOmitidos;
    const status: SyncRunStatus =
      counters.errorCount === 0 ? "SUCCESS" : procesados > 0 ? "PARTIAL" : "FAILED";

    await this.syncRunsService.finishRun(run.id, { ...counters, status, tablasProcesadas });

    return { syncRunId: run.id, status, ...counters };
  }

  private async upsertHistRecord(params: {
    tienda: { id: string; codigoLegacy: string };
    runId: string;
    entidadDestino: EntidadDestino;
    tablaOrigen: string;
    registro: IngestRegistroDto;
  }): Promise<{ outcome: UpsertOutcome; hash: string }> {
    const { tienda, runId, entidadDestino, tablaOrigen, registro } = params;
    const hash = computeHashRegistro(entidadDestino, registro.payload);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const delegate = this.getDelegate(tx, entidadDestino);

      const current = await delegate.findFirst({
        where: {
          dimTiendaId: tienda.id,
          tablaOrigen,
          pkOrigen: registro.pkOrigen,
          esActual: true,
        },
      });

      if (current && current.hashRegistro === hash) {
        return { outcome: "SKIPPED" as const, hash };
      }

      if (current) {
        await delegate.update({
          where: { id: current.id },
          data: { esActual: false, validoHasta: now },
        });
      }

      // El indice unico es (tienda, tabla, pk, hash). Si el valor de este
      // registro ya paso por este mismo estado antes (ej. un conteo de
      // inventario que sube y baja entre los mismos numeros), ya existe una
      // fila con este hash exacto marcada esActual=false -- crear otra
      // chocaria con el indice. En ese caso se reactiva esa fila en vez de
      // duplicarla.
      const existingWithHash = await delegate.findFirst({
        where: { dimTiendaId: tienda.id, tablaOrigen, pkOrigen: registro.pkOrigen, hashRegistro: hash },
      });

      if (existingWithHash) {
        await delegate.update({
          where: { id: existingWithHash.id },
          data: {
            codigoTiendaLegacy: tienda.codigoLegacy,
            operacion: registro.operacion,
            payloadJson: registro.payload as Prisma.InputJsonValue,
            esActual: true,
            validoDesde: now,
            validoHasta: null,
            syncRunId: runId,
            fechaExtraida: new Date(registro.fechaExtraida),
            fechaCargada: now,
          },
        });

        return { outcome: (current ? "UPDATED" : "INSERTED") as UpsertOutcome, hash };
      }

      await delegate.create({
        data: {
          dimTiendaId: tienda.id,
          codigoTiendaLegacy: tienda.codigoLegacy,
          tablaOrigen,
          pkOrigen: registro.pkOrigen,
          operacion: registro.operacion,
          hashRegistro: hash,
          payloadJson: registro.payload as Prisma.InputJsonValue,
          esActual: true,
          validoDesde: now,
          validoHasta: null,
          syncRunId: runId,
          fechaExtraida: new Date(registro.fechaExtraida),
          fechaCargada: now,
        },
      });

      return { outcome: (current ? "UPDATED" : "INSERTED") as UpsertOutcome, hash };
    });
  }

  private getDelegate(tx: TransactionClient, entidadDestino: EntidadDestino): HistDelegate {
    switch (entidadDestino) {
      case "DIM_ARTICULOS_HIST":
        return tx.dimArticulosHist;
      case "DIM_CLIENTES_HIST":
        return tx.dimClientesHist;
      case "HECH_INVENTARIO_HIST":
        return tx.hechInventarioHist;
      case "HECH_VENTAS_HIST":
        return tx.hechVentasHist;
      case "HECH_VENTAS_DETALLE_HIST":
        return tx.hechVentasDetalleHist;
      case "HECH_PAGOS_HIST":
        return tx.hechPagosHist;
      case "HECH_CAJAS_HIST":
        return tx.hechCajasHist;
      default:
        throw new BadRequestException(`entidadDestino desconocida: ${entidadDestino}`);
    }
  }
}

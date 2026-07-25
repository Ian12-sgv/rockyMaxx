import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { CreatePriceChangeBatchDto } from "./dto/create-price-change-batch.dto";
import { PreviewPriceChangeBatchDto } from "./dto/preview-price-change-batch.dto";
import { PriceChangeSyncPullDto } from "./dto/price-change-sync-pull.dto";
import { RetryPriceChangeBatchDto } from "./dto/retry-price-change-batch.dto";
import { PriceChangesService } from "./price-changes.service";

// Rol ORIGEN por defecto (creacion/preview/envio/reintento). Restringido a "sistema",
// igual que la transferencia masiva de inventario (transfers.controller.ts:41-54), porque
// el origen permitido es Bodega Central/Bodega 002, no operacion de caja/tienda.
// El endpoint sync/import (rol VPS/REMOTO) tiene su propio override de grupos mas abajo,
// igual patron que inventory-bulk/import en transfers.controller.ts:56-60.
@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("sistema")
@Controller("price-changes")
export class PriceChangesController {
  constructor(private readonly priceChangesService: PriceChangesService) {}

  @Post("preview")
  async preview(@Body() previewPriceChangeBatchDto: PreviewPriceChangeBatchDto) {
    return this.priceChangesService.previewPriceChangeBatch(previewPriceChangeBatchDto);
  }

  @Post()
  async create(
    @Body() createPriceChangeBatchDto: CreatePriceChangeBatchDto,
    @CurrentUser() user: UserView,
  ) {
    return this.priceChangesService.createPriceChangeBatch(createPriceChangeBatchDto, user);
  }

  // Rol VPS/REMOTO: recibido en la instancia del nodo destino. Llamado por el ORIGEN
  // autenticado como cuenta tecnica (admin/sistema), no por un usuario de caja.
  @RequireGroups("admin", "sistema")
  @Post("sync/import")
  async importSync(@Body() body: Record<string, unknown>) {
    return this.priceChangesService.importRemotePriceChangeBatch(body);
  }

  // Rol VPS/REMOTO: expone lo pendiente para el rol LOCAL SERVICE (hoy la misma
  // instancia; ver Decision 1). Solo lectura, nunca aplica ni marca nada.
  @RequireGroups("admin", "sistema")
  @Get("sync/pending")
  async pending(@Query() priceChangeSyncPullDto: PriceChangeSyncPullDto) {
    const pending = await this.priceChangesService.listPendingPriceChangeSyncForCurrentNode(
      priceChangeSyncPullDto.limit,
    );
    return { pending };
  }

  // Rol LOCAL SERVICE: dispara la recepcion local de lo pendiente (materializa
  // PRICE_CHANGE_BATCH/_ITEM/_STORE en RECEIVED_BY_STORE). Reutilizable por un futuro
  // timer, ademas de invocable manualmente.
  @RequireGroups("admin", "sistema")
  @Post("sync/pull")
  async pull(@Body() priceChangeSyncPullDto: PriceChangeSyncPullDto) {
    return this.priceChangesService.pullPendingPriceChanges(priceChangeSyncPullDto.limit);
  }

  // Rol LOCAL SERVICE: aplica TODOS los batches locales pendientes de este nodo de una
  // vez (RECEIVED_BY_STORE/APPLYING). Reutilizable por un futuro timer.
  @RequireGroups("admin", "sistema")
  @Post("sync/apply-pending")
  async applyPending(@Body() priceChangeSyncPullDto: PriceChangeSyncPullDto) {
    return this.priceChangesService.applyPendingLocalPriceChanges(priceChangeSyncPullDto.limit);
  }

  // Rol VPS/REMOTO: recibe el resultado final que reporta el rol LOCAL SERVICE (destino
  // -> origen). Mismo nivel tecnico que sync/import/sync/pending.
  @RequireGroups("admin", "sistema")
  @Post("sync/report-result")
  async reportResultSync(@Body() body: Record<string, unknown>) {
    return this.priceChangesService.receivePriceChangeSyncResult(body);
  }

  // Rol LOCAL SERVICE: reporta TODOS los batches locales en estado terminal de este nodo.
  // Reutilizable por un futuro timer.
  @RequireGroups("admin", "sistema")
  @Post("sync/report-pending-results")
  async reportPendingResults(@Body() priceChangeSyncPullDto: PriceChangeSyncPullDto) {
    return this.priceChangesService.reportPendingPriceChangeResults(priceChangeSyncPullDto.limit);
  }

  // Rol ORIGEN: hace pull de remote-status para todos los batches de este origen con
  // alguna tienda en SENT_TO_VPS/WAITING_STORE_REFRESH. Reutilizable por un futuro timer.
  @Post("sync/pull-remote-statuses")
  async pullRemoteStatuses(@Body() priceChangeSyncPullDto: PriceChangeSyncPullDto) {
    return this.priceChangesService.pullRemotePriceChangeStatuses(priceChangeSyncPullDto.limit);
  }

  @Post(":batchId/send")
  async send(@Param("batchId") batchId: string) {
    return this.priceChangesService.sendPriceChangeBatch(batchId);
  }

  @Post(":batchId/retry")
  async retry(@Param("batchId") batchId: string, @Body() retryPriceChangeBatchDto: RetryPriceChangeBatchDto) {
    return this.priceChangesService.retryPriceChangeBatchStores(batchId, retryPriceChangeBatchDto.destinationNodeIds);
  }

  // Rol LOCAL SERVICE: aplica UN batch local ya recibido (RECEIVED_BY_STORE/APPLYING) en
  // INVENTARIO. Mismo nivel de acceso que los demas endpoints sync/* (tecnico), no
  // "sistema" puro, porque en el futuro podria dispararlo un proceso separado del rol
  // LOCAL SERVICE autenticado como cuenta tecnica.
  @RequireGroups("admin", "sistema")
  @Post(":batchId/apply-local")
  async applyLocal(@Param("batchId") batchId: string) {
    return this.priceChangesService.applyLocalPriceChangeBatch(batchId);
  }

  // Rol LOCAL SERVICE: reporta el resultado de UN batch en estado terminal al rol
  // VPS/REMOTO (de este mismo nodo hoy).
  @RequireGroups("admin", "sistema")
  @Post(":batchId/report-result")
  async reportResult(@Param("batchId") batchId: string) {
    return this.priceChangesService.reportLocalPriceChangeResult(batchId);
  }

  // Rol VPS/REMOTO: lo que el ORIGEN consulta (pull) para saber el estado de este batch
  // en este nodo. Nunca hay push del destino hacia el origen (Decision 1).
  @RequireGroups("admin", "sistema")
  @Get(":batchId/remote-status")
  async remoteStatus(@Param("batchId") batchId: string) {
    return this.priceChangesService.getPriceChangeRemoteStatus(batchId);
  }

  // Rol ORIGEN: dispara el pull de remote-status de UN batch contra cada tienda destino.
  @Post(":batchId/pull-remote-status")
  async pullRemoteStatus(@Param("batchId") batchId: string) {
    return this.priceChangesService.pullRemotePriceChangeStatus(batchId);
  }

  // Rol ORIGEN, solo lectura. Descarga directa (application/pdf), mismo patron ya usado en
  // maintenance.controller.ts:22-48 (StreamableFile + headers manuales), no el patron
  // JSON+base64 de cajas -- este endpoint devuelve un binario real para poder abrirlo o
  // descargarlo directo (GET .../report.pdf). No consulta el VPS, no cambia estados, no
  // aplica ni reporta sync: getPriceChangeBatchReportData solo hace SELECT.
  @Get(":batchId/report.pdf")
  async reportPdf(@Param("batchId") batchId: string, @Res({ passthrough: true }) response: any) {
    const { fileName, pdf } = await this.priceChangesService.generatePriceChangeBatchReportPdf(batchId);

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    response.setHeader("Cache-Control", "no-store");

    return new StreamableFile(pdf);
  }

  @Get(":batchId")
  async findOne(@Param("batchId") batchId: string) {
    return this.priceChangesService.getPriceChangeBatch(batchId);
  }
}

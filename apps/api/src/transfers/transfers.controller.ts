import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { ApproveTransferDto } from "./dto/approve-transfer.dto";
import { CreateTransferDto } from "./dto/create-transfer.dto";
import { FindTransfersDto } from "./dto/find-transfers.dto";
import { FindTransferSyncOutboxDto, PushTransferSyncDto, RegisterTransferSyncNodeDto } from "./dto/transfer-sync.dto";
import { UpdateTransferDto } from "./dto/update-transfer.dto";
import { TransfersService } from "./transfers.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get("metadata")
  async getMetadata() {
    return this.transfersService.getMetadata();
  }

  @Get()
  async findAll(@Query() findTransfersDto: FindTransfersDto) {
    return this.transfersService.searchTransfers(findTransfersDto);
  }

  @Get("sync/nodes")
  async listSyncNodes() {
    return this.transfersService.listTransferSyncNodes();
  }

  @Post("sync/nodes")
  async registerSyncNode(@Body() registerTransferSyncNodeDto: RegisterTransferSyncNodeDto) {
    return this.transfersService.registerTransferSyncNode(registerTransferSyncNodeDto);
  }

  @Get("sync/outbox")
  async listSyncOutbox(@Query() findTransferSyncOutboxDto: FindTransferSyncOutboxDto) {
    return this.transfersService.listTransferSyncOutbox(findTransferSyncOutboxDto);
  }

  @Get("sync/inbox/export")
  async exportSyncInbox(@Query() pushTransferSyncDto: PushTransferSyncDto) {
    return this.transfersService.exportTransferSyncInbox(pushTransferSyncDto);
  }

  @Post("sync/push")
  async pushPendingSync(@Body() pushTransferSyncDto: PushTransferSyncDto) {
    return this.transfersService.pushPendingTransferSync(pushTransferSyncDto);
  }

  @Post("sync/pull")
  async pullPendingSync(@Body() pushTransferSyncDto: PushTransferSyncDto) {
    return this.transfersService.pullRemoteTransferSync(pushTransferSyncDto);
  }

  @Post("sync/outbox/:globalId/sent")
  async markSyncOutboxSent(@Param("globalId") globalId: string) {
    return this.transfersService.markTransferSyncOutboxSent(globalId);
  }

  @Post("sync/import")
  async importSyncPackage(@Body() body: Record<string, unknown>) {
    return this.transfersService.importTransferSyncPackage(body);
  }

  @Get("inbound")
  async findInbound(@Query() findTransfersDto: FindTransfersDto) {
    return this.transfersService.searchInboundTransfers(findTransfersDto);
  }

  @Get("inbound/:numero")
  async findInboundOne(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.findInboundOne(numero);
  }

  @Post("inbound/:numero/load")
  async loadInbound(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.loadInboundTransfer(numero);
  }

  @Get(":numero")
  async findOne(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.findOne(numero);
  }

  @Post()
  async create(@Body() createTransferDto: CreateTransferDto, @CurrentUser() user: UserView) {
    return this.transfersService.createTransfer(createTransferDto, user);
  }

  @Patch(":numero")
  async update(
    @Param("numero", ParseIntPipe) numero: number,
    @Body() updateTransferDto: UpdateTransferDto,
  ) {
    return this.transfersService.updateTransfer(numero, updateTransferDto);
  }

  @Post(":numero/approve")
  async approve(@Param("numero", ParseIntPipe) numero: number, @Body() approveTransferDto: ApproveTransferDto) {
    return this.transfersService.approveTransfer(numero, approveTransferDto);
  }

  @Post(":numero/sync/requeue")
  async requeueSyncPackage(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.requeueTransferSyncPackage(numero);
  }

  @Delete(":numero")
  async remove(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.deletePendingTransfer(numero);
  }
}

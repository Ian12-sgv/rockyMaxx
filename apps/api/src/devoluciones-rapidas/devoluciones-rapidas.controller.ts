import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { DevolucionesRapidasService } from "./devoluciones-rapidas.service";
import { CreateDevolucionRapidaDto } from "./dto/create-devolucion-rapida.dto";
import { FindDevolucionesRapidasDto } from "./dto/find-devoluciones-rapidas.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("devoluciones-rapidas")
export class DevolucionesRapidasController {
  constructor(private readonly devolucionesRapidasService: DevolucionesRapidasService) {}

  @Get("metadata")
  async getMetadata() {
    return this.devolucionesRapidasService.getMetadata();
  }

  @Get()
  async findAll(@Query() findDto: FindDevolucionesRapidasDto) {
    return this.devolucionesRapidasService.search(findDto);
  }

  @Get("sync/outbox")
  async listOutbox(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.devolucionesRapidasService.listOutbox(status, this.toLimit(limit));
  }

  @Get("sync/inbox/export")
  async exportInbox(@Query("limit") limit?: string) {
    return this.devolucionesRapidasService.exportInbox(this.toLimit(limit));
  }

  @Post("sync/push")
  async pushPending() {
    return this.devolucionesRapidasService.pushPending();
  }

  @Post("sync/pull")
  async pullRemote() {
    return this.devolucionesRapidasService.pullRemote();
  }

  @Post("sync/import")
  async importPackage(@Body() body: Record<string, unknown>) {
    return this.devolucionesRapidasService.importPackage(body);
  }

  @Get("inbound")
  async findInbound(@Query() findDto: FindDevolucionesRapidasDto) {
    return this.devolucionesRapidasService.searchInbound(findDto);
  }

  @Get("inbound/:globalId")
  async findInboundOne(@Param("globalId") globalId: string) {
    return this.devolucionesRapidasService.findInboundOne(globalId);
  }

  @Post("inbound/:globalId/load")
  async loadInbound(@Param("globalId") globalId: string, @CurrentUser() user: UserView) {
    return this.devolucionesRapidasService.loadInbound(globalId, user);
  }

  @Get(":numero")
  async findOne(@Param("numero", ParseIntPipe) numero: number) {
    return this.devolucionesRapidasService.findOne(numero);
  }

  @Post()
  async create(@Body() createDto: CreateDevolucionRapidaDto, @CurrentUser() user: UserView) {
    return this.devolucionesRapidasService.create(createDto, user);
  }

  @Patch(":numero")
  async update(@Param("numero", ParseIntPipe) numero: number, @Body() updateDto: CreateDevolucionRapidaDto) {
    return this.devolucionesRapidasService.update(numero, updateDto);
  }

  @Post(":numero/approve")
  async approve(@Param("numero", ParseIntPipe) numero: number) {
    return this.devolucionesRapidasService.approve(numero);
  }

  @Post(":numero/sync/requeue")
  async requeue(@Param("numero", ParseIntPipe) numero: number) {
    return this.devolucionesRapidasService.requeue(numero);
  }

  @Delete(":numero")
  async remove(@Param("numero", ParseIntPipe) numero: number) {
    return this.devolucionesRapidasService.remove(numero);
  }

  private toLimit(value: string | undefined) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
  }
}

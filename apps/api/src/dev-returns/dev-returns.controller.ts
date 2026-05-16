import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { DevReturnsService } from "./dev-returns.service";
import { ApproveDevReturnDto } from "./dto/approve-dev-return.dto";
import { CreateDevDraftDto } from "./dto/create-dev-draft.dto";
import { FindDevDraftsDto } from "./dto/find-dev-drafts.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("dev-returns")
export class DevReturnsController {
  constructor(private readonly devReturnsService: DevReturnsService) {}

  @Get("metadata")
  async getMetadata() {
    return this.devReturnsService.getMetadata();
  }

  @Get("drafts")
  async findDrafts(@Query() findDevDraftsDto: FindDevDraftsDto) {
    return this.devReturnsService.searchDrafts(findDevDraftsDto);
  }

  @Get("drafts/inbound")
  async findInboundDrafts(@Query() findDevDraftsDto: FindDevDraftsDto) {
    return this.devReturnsService.searchInboundDrafts(findDevDraftsDto);
  }

  @Get("drafts/:numero")
  async findDraft(@Param("numero") numero: string) {
    return this.devReturnsService.findDraft(BigInt(numero));
  }

  @Get("drafts/inbound/:globalId")
  async findInboundDraft(@Param("globalId") globalId: string) {
    return this.devReturnsService.findInboundDraft(globalId);
  }

  @Post("drafts")
  async createDraft(@Body() createDevDraftDto: CreateDevDraftDto, @CurrentUser() user: UserView) {
    return this.devReturnsService.createDraft(createDevDraftDto, user);
  }

  @Patch("drafts/:numero")
  async updateDraft(
    @Param("numero") numero: string,
    @Body() createDevDraftDto: CreateDevDraftDto,
  ) {
    return this.devReturnsService.updateDraft(BigInt(numero), createDevDraftDto);
  }

  @Post("drafts/:numero/export")
  async exportDraft(@Param("numero") numero: string) {
    return this.devReturnsService.exportDraft(BigInt(numero));
  }

  @Post("drafts/:numero/destination-approve")
  async approveDraftAtDestination(
    @Param("numero") numero: string,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveInboundDraftByNumero(BigInt(numero), user);
  }

  @Post("drafts/inbound/:globalId/approve")
  async approveInboundDraft(
    @Param("globalId") globalId: string,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveInboundDraft(globalId, user);
  }

  @Post("drafts/:numero/origin-approve")
  async approveReturnAtOrigin(
    @Param("numero") numero: string,
    @Body() approveDevReturnDto: ApproveDevReturnDto,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveReturnAtOrigin(BigInt(numero), approveDevReturnDto, user);
  }

  @Get("returns")
  async findReturns(@Query() findDevDraftsDto: FindDevDraftsDto) {
    return this.devReturnsService.searchReturns(findDevDraftsDto);
  }

  @Get("returns/:numero")
  async findReturn(@Param("numero") numero: string) {
    return this.devReturnsService.findReturn(Number(numero));
  }

  @Post("returns/:numero/export")
  async exportReturn(@Param("numero") numero: string) {
    return this.devReturnsService.exportReturn(Number(numero));
  }

  @Get("inbound")
  async findInboundReturns(@Query() findDevDraftsDto: FindDevDraftsDto) {
    return this.devReturnsService.searchInboundReturns(findDevDraftsDto);
  }

  @Get("inbound/:numero")
  async findInboundReturn(
    @Param("numero") numero: string,
    @Query("codigoEnvia") codigoEnvia?: string,
  ) {
    return this.devReturnsService.findInboundReturn(Number(numero), codigoEnvia);
  }

  @Post("inbound/:numero/approve")
  async approveInboundReturn(
    @Param("numero") numero: string,
    @Query("codigoEnvia") codigoEnvia: string | undefined,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveInboundReturn(Number(numero), codigoEnvia, user);
  }

  @Post(":numero/destination-approve")
  async approveReturnAtDestination(
    @Param("numero") numero: string,
    @Query("codigoEnvia") codigoEnvia: string | undefined,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveInboundReturn(Number(numero), codigoEnvia, user);
  }

  @Post("sync/import")
  async importSyncPackage(@Body() body: Record<string, unknown>) {
    return this.devReturnsService.importSyncPackage(body);
  }
}

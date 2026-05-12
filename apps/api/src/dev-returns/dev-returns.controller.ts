import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

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

  @Get("drafts")
  async findDrafts(@Query() findDevDraftsDto: FindDevDraftsDto) {
    return this.devReturnsService.searchDrafts(findDevDraftsDto);
  }

  @Get("drafts/:numero")
  async findDraft(@Param("numero") numero: string) {
    return this.devReturnsService.findDraft(BigInt(numero));
  }

  @Post("drafts")
  async createDraft(@Body() createDevDraftDto: CreateDevDraftDto, @CurrentUser() user: UserView) {
    return this.devReturnsService.createDraft(createDevDraftDto, user);
  }

  @Post("drafts/:numero/destination-approve")
  async approveDraftAtDestination(
    @Param("numero") numero: string,
  ) {
    return this.devReturnsService.approveDraftAtDestination(BigInt(numero));
  }

  @Post("drafts/:numero/origin-approve")
  async approveReturnAtOrigin(
    @Param("numero") numero: string,
    @Body() approveDevReturnDto: ApproveDevReturnDto,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveReturnAtOrigin(BigInt(numero), approveDevReturnDto, user);
  }

  @Post(":numero/destination-approve")
  async approveReturnAtDestination(
    @Param("numero") numero: string,
    @CurrentUser() user: UserView,
  ) {
    return this.devReturnsService.approveReturnAtDestination(Number(numero), user);
  }
}

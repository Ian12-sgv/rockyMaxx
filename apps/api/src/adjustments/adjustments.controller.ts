import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { AdjustmentsService } from "./adjustments.service";
import { CreateAdjustmentDto } from "./dto/create-adjustment.dto";
import { FindAdjustmentsDto } from "./dto/find-adjustments.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("adjustments")
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Get()
  async findAll(@Query() findAdjustmentsDto: FindAdjustmentsDto) {
    return this.adjustmentsService.searchAdjustments(findAdjustmentsDto);
  }

  @Get(":numero")
  async findOne(@Param("numero") numero: string) {
    return this.adjustmentsService.findOne(BigInt(numero));
  }

  @Post()
  async create(@Body() createAdjustmentDto: CreateAdjustmentDto, @CurrentUser() user: UserView) {
    return this.adjustmentsService.createAdjustment(createAdjustmentDto, user);
  }
}

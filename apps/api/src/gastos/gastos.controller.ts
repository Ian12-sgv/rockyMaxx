import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { CreateGastoDto } from "./dto/create-gasto.dto";
import { FindGastosDto } from "./dto/find-gastos.dto";
import { UpdateGastoDto } from "./dto/update-gasto.dto";
import { GastosService } from "./gastos.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("gastos")
export class GastosController {
  constructor(private readonly gastosService: GastosService) {}

  @Get("metadata")
  getMetadata() {
    return this.gastosService.getMetadata();
  }

  @Get()
  async findAll(@Query() findGastosDto: FindGastosDto) {
    return this.gastosService.findAll(findGastosDto);
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return {
      gasto: await this.gastosService.findOne(id),
    };
  }

  @Post()
  async create(@Body() createGastoDto: CreateGastoDto, @CurrentUser() user: UserView) {
    return {
      gasto: await this.gastosService.create(createGastoDto, user),
    };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() updateGastoDto: UpdateGastoDto) {
    return {
      gasto: await this.gastosService.update(id, updateGastoDto),
    };
  }

  @Post(":id/anular")
  async anular(@Param("id") id: string) {
    return {
      gasto: await this.gastosService.anular(id),
    };
  }
}

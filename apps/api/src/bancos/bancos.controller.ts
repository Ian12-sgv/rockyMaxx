import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { BancosService } from "./bancos.service";
import { CreateBancoDto } from "./dto/create-banco.dto";
import { FindBancosDto } from "./dto/find-bancos.dto";
import { UpdateBancoDto } from "./dto/update-banco.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("bancos")
export class BancosController {
  constructor(private readonly bancosService: BancosService) {}

  @Get("metadata")
  async getMetadata() {
    return this.bancosService.getMetadata();
  }

  @Get()
  async findAll(@Query() findBancosDto: FindBancosDto) {
    return {
      bancos: await this.bancosService.findAll(findBancosDto),
    };
  }

  @Get(":codigo")
  async findOne(@Param("codigo") codigo: string) {
    return {
      banco: await this.bancosService.findOne(codigo),
    };
  }

  @Post()
  async create(@Body() createBancoDto: CreateBancoDto) {
    return {
      banco: await this.bancosService.create(createBancoDto),
    };
  }

  @Patch(":codigo")
  async update(@Param("codigo") codigo: string, @Body() updateBancoDto: UpdateBancoDto) {
    return {
      banco: await this.bancosService.update(codigo, updateBancoDto),
    };
  }

  @Delete(":codigo")
  async remove(@Param("codigo") codigo: string) {
    await this.bancosService.remove(codigo);

    return {
      deleted: true,
    };
  }
}

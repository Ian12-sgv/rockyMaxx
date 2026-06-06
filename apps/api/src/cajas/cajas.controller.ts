import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CajasService } from "./cajas.service";
import { CreateCajaDto } from "./dto/create-caja.dto";
import { FindCajasDto } from "./dto/find-cajas.dto";
import { UpdateCajaDto } from "./dto/update-caja.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("cajas")
export class CajasController {
  constructor(private readonly cajasService: CajasService) {}

  @Get("metadata")
  async getMetadata() {
    return this.cajasService.getMetadata();
  }

  @Get()
  async findAll(@Query() findCajasDto: FindCajasDto) {
    return {
      cajas: await this.cajasService.findAll(findCajasDto),
    };
  }

  @Get(":serie/:fecha")
  async findOne(@Param("serie") serie: string, @Param("fecha") fecha: string) {
    return {
      caja: await this.cajasService.findOne(serie, fecha),
    };
  }

  @Post()
  async create(@Body() createCajaDto: CreateCajaDto) {
    return {
      caja: await this.cajasService.create(createCajaDto),
    };
  }

  @Patch(":serie/:fecha")
  async update(
    @Param("serie") serie: string,
    @Param("fecha") fecha: string,
    @Body() updateCajaDto: UpdateCajaDto,
  ) {
    return {
      caja: await this.cajasService.update(serie, fecha, updateCajaDto),
    };
  }

  @Delete(":serie/:fecha")
  async remove(@Param("serie") serie: string, @Param("fecha") fecha: string) {
    await this.cajasService.remove(serie, fecha);

    return {
      deleted: true,
    };
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateTrabajadorDto } from "./dto/create-trabajador.dto";
import { FindTrabajadoresDto } from "./dto/find-trabajadores.dto";
import { UpdateTrabajadorDto } from "./dto/update-trabajador.dto";
import { TrabajadoresService } from "./trabajadores.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("trabajadores")
export class TrabajadoresController {
  constructor(private readonly trabajadoresService: TrabajadoresService) {}

  @Get("metadata")
  @RequireGroups("admin", "caja")
  async getMetadata() {
    return this.trabajadoresService.getMetadata();
  }

  @Get()
  @RequireGroups("admin", "caja")
  async findAll(@Query() findTrabajadoresDto: FindTrabajadoresDto) {
    return {
      trabajadores: await this.trabajadoresService.findAll(findTrabajadoresDto),
    };
  }

  @Get(":cedula")
  @RequireGroups("admin", "caja")
  async findOne(@Param("cedula") cedula: string) {
    return {
      trabajador: await this.trabajadoresService.findOne(cedula),
    };
  }

  @Post()
  @RequireGroups("admin", "caja")
  async create(@Body() createTrabajadorDto: CreateTrabajadorDto) {
    return {
      trabajador: await this.trabajadoresService.create(createTrabajadorDto),
    };
  }

  @Patch(":cedula")
  async update(@Param("cedula") cedula: string, @Body() updateTrabajadorDto: UpdateTrabajadorDto) {
    return {
      trabajador: await this.trabajadoresService.update(cedula, updateTrabajadorDto),
    };
  }

  @Delete(":cedula")
  async remove(@Param("cedula") cedula: string) {
    await this.trabajadoresService.remove(cedula);

    return {
      deleted: true,
    };
  }
}

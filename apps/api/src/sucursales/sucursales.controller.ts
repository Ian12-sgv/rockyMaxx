import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateSucursalDto } from "./dto/create-sucursal.dto";
import { FindSucursalesDto } from "./dto/find-sucursales.dto";
import { UpdateSucursalDto } from "./dto/update-sucursal.dto";
import { SucursalesService } from "./sucursales.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("sucursales")
export class SucursalesController {
  constructor(private readonly sucursalesService: SucursalesService) {}

  @Get()
  async findAll(@Query() findSucursalesDto: FindSucursalesDto) {
    return {
      sucursales: await this.sucursalesService.findAll(findSucursalesDto),
    };
  }

  @Get(":codigo")
  async findOne(@Param("codigo") codigo: string) {
    return {
      sucursal: await this.sucursalesService.findOne(codigo),
    };
  }

  @Post()
  async create(@Body() createSucursalDto: CreateSucursalDto) {
    return {
      sucursal: await this.sucursalesService.create(createSucursalDto),
    };
  }

  @Patch(":codigo")
  async update(@Param("codigo") codigo: string, @Body() updateSucursalDto: UpdateSucursalDto) {
    return {
      sucursal: await this.sucursalesService.update(codigo, updateSucursalDto),
    };
  }
}

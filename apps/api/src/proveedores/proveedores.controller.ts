import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateProveedorDto } from "./dto/create-proveedor.dto";
import { FindProveedoresDto } from "./dto/find-proveedores.dto";
import { UpdateProveedorDto } from "./dto/update-proveedor.dto";
import { ProveedoresService } from "./proveedores.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("proveedores")
export class ProveedoresController {
  constructor(private readonly proveedoresService: ProveedoresService) {}

  @Get("metadata")
  async getMetadata() {
    return this.proveedoresService.getMetadata();
  }

  @Get()
  async findAll(@Query() findProveedoresDto: FindProveedoresDto) {
    return {
      proveedores: await this.proveedoresService.findAll(findProveedoresDto),
    };
  }

  @Get(":codigo")
  async findOne(@Param("codigo") codigo: string) {
    return {
      proveedor: await this.proveedoresService.findOne(codigo),
    };
  }

  @Post()
  async create(@Body() createProveedorDto: CreateProveedorDto) {
    return {
      proveedor: await this.proveedoresService.create(createProveedorDto),
    };
  }

  @Patch(":codigo")
  async update(@Param("codigo") codigo: string, @Body() updateProveedorDto: UpdateProveedorDto) {
    return {
      proveedor: await this.proveedoresService.update(codigo, updateProveedorDto),
    };
  }

  @Delete(":codigo")
  async remove(@Param("codigo") codigo: string) {
    await this.proveedoresService.remove(codigo);

    return {
      deleted: true,
    };
  }
}

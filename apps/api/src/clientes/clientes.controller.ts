import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ClientesService } from "./clientes.service";
import { CreateClienteDto } from "./dto/create-cliente.dto";
import { FindClientesDto } from "./dto/find-clientes.dto";
import { UpdateClienteDto } from "./dto/update-cliente.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("clientes")
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get("metadata")
  @RequireGroups("admin", "caja")
  async getMetadata() {
    return this.clientesService.getMetadata();
  }

  @Get()
  @RequireGroups("admin", "caja")
  async findAll(@Query() findClientesDto: FindClientesDto) {
    return {
      clientes: await this.clientesService.findAll(findClientesDto),
    };
  }

  @Get(":codigo")
  @RequireGroups("admin", "caja")
  async findOne(@Param("codigo") codigo: string) {
    return {
      cliente: await this.clientesService.findOne(codigo),
    };
  }

  @Post()
  @RequireGroups("admin", "caja")
  async create(@Body() createClienteDto: CreateClienteDto) {
    return {
      cliente: await this.clientesService.create(createClienteDto),
    };
  }

  @Patch(":codigo")
  async update(@Param("codigo") codigo: string, @Body() updateClienteDto: UpdateClienteDto) {
    return {
      cliente: await this.clientesService.update(codigo, updateClienteDto),
    };
  }

  @Delete(":codigo")
  async remove(@Param("codigo") codigo: string) {
    await this.clientesService.remove(codigo);

    return {
      deleted: true,
    };
  }
}

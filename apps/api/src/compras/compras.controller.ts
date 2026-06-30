import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { ComprasService } from "./compras.service";
import { CreateCompraDto } from "./dto/create-compra.dto";
import { FindComprasDto } from "./dto/find-compras.dto";
import { UpdateCompraDto } from "./dto/update-compra.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("compras")
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Get("metadata")
  async getMetadata(@CurrentUser() user: UserView) {
    return await this.comprasService.getMetadata(user);
  }

  @Get()
  async findAll(@Query() query: FindComprasDto) {
    return {
      compras: await this.comprasService.findAll(query),
    };
  }

  @Get(":documento/:proveedor")
  async findOne(@Param("documento") documento: string, @Param("proveedor") proveedor: string) {
    return {
      compra: await this.comprasService.findOne(documento, proveedor),
    };
  }

  @Post()
  async create(@Body() payload: CreateCompraDto, @CurrentUser() user: UserView) {
    return {
      compra: await this.comprasService.create(payload, user),
    };
  }

  @Patch(":documento/:proveedor")
  async update(
    @Param("documento") documento: string,
    @Param("proveedor") proveedor: string,
    @Body() payload: UpdateCompraDto,
    @CurrentUser() user: UserView,
  ) {
    return {
      compra: await this.comprasService.update(documento, proveedor, payload, user),
    };
  }

  @Patch(":documento/:proveedor/approve")
  async approve(@Param("documento") documento: string, @Param("proveedor") proveedor: string) {
    return {
      compra: await this.comprasService.approve(documento, proveedor),
    };
  }

  @Delete(":documento/:proveedor")
  async remove(@Param("documento") documento: string, @Param("proveedor") proveedor: string) {
    await this.comprasService.remove(documento, proveedor);
    return {
      deleted: true,
    };
  }
}


import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateTipoPagoDto } from "./dto/create-tipo-pago.dto";
import { FindTiposPagoDto } from "./dto/find-tipos-pago.dto";
import { UpdateTipoPagoDto } from "./dto/update-tipo-pago.dto";
import { TiposPagoService } from "./tipos-pago.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("tipos-pago")
export class TiposPagoController {
  constructor(private readonly tiposPagoService: TiposPagoService) {}

  @Get("metadata")
  async getMetadata() {
    return this.tiposPagoService.getMetadata();
  }

  @Get()
  async findAll(@Query() findTiposPagoDto: FindTiposPagoDto) {
    return {
      tiposPago: await this.tiposPagoService.findAll(findTiposPagoDto),
    };
  }

  @Get(":codigo")
  async findOne(@Param("codigo") codigo: string) {
    return {
      tipoPago: await this.tiposPagoService.findOne(codigo),
    };
  }

  @Post()
  async create(@Body() createTipoPagoDto: CreateTipoPagoDto) {
    return {
      tipoPago: await this.tiposPagoService.create(createTipoPagoDto),
    };
  }

  @Patch(":codigo")
  async update(@Param("codigo") codigo: string, @Body() updateTipoPagoDto: UpdateTipoPagoDto) {
    return {
      tipoPago: await this.tiposPagoService.update(codigo, updateTipoPagoDto),
    };
  }

  @Delete(":codigo")
  async remove(@Param("codigo") codigo: string) {
    await this.tiposPagoService.remove(codigo);

    return {
      deleted: true,
    };
  }
}
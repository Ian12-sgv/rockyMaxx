import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateImpresoraDto } from "./dto/create-impresora.dto";
import { FindImpresorasDto } from "./dto/find-impresoras.dto";
import { UpdateImpresoraDto } from "./dto/update-impresora.dto";
import { ImpresorasService } from "./impresoras.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("impresoras")
export class ImpresorasController {
  constructor(private readonly impresorasService: ImpresorasService) {}

  @Get("metadata")
  async getMetadata() {
    return this.impresorasService.getMetadata();
  }

  @Get()
  async findAll(@Query() findImpresorasDto: FindImpresorasDto) {
    return {
      impresoras: await this.impresorasService.findAll(findImpresorasDto),
    };
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return {
      impresora: await this.impresorasService.findOne(id),
    };
  }

  @Post()
  async create(@Body() createImpresoraDto: CreateImpresoraDto) {
    return {
      impresora: await this.impresorasService.create(createImpresoraDto),
    };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() updateImpresoraDto: UpdateImpresoraDto) {
    return {
      impresora: await this.impresorasService.update(id, updateImpresoraDto),
    };
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    await this.impresorasService.remove(id);
    return {
      deleted: true,
    };
  }
}

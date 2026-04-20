import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateMerchandiseDto } from "./dto/create-merchandise.dto";
import { ResolveCreationAutofillDto } from "./dto/resolve-creation-autofill.dto";
import { InventoryService } from "./inventory.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get("creation-metadata")
  async getCreationMetadata() {
    return this.inventoryService.getCreationMetadata();
  }

  @Post("creation-autofill")
  async getCreationAutofill(@Body() resolveCreationAutofillDto: ResolveCreationAutofillDto) {
    return this.inventoryService.getCreationAutofill(resolveCreationAutofillDto);
  }

  @Get(":codigoBarra")
  async findOne(@Param("codigoBarra") codigoBarra: string) {
    return {
      mercancia: await this.inventoryService.findOne(codigoBarra),
    };
  }

  @Post()
  async create(@Body() createMerchandiseDto: CreateMerchandiseDto) {
    return {
      mercancia: await this.inventoryService.createMerchandise(createMerchandiseDto),
    };
  }
}

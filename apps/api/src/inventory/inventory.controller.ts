import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CATALOG_IMPORT_EXCEL_PERMISSION_CODE } from "../shared/permission-codes.util";
import { CreateCatalogEntryDto } from "./dto/create-catalog-entry.dto";
import { CreateMerchandiseDto } from "./dto/create-merchandise.dto";
import { FindMerchandiseDto } from "./dto/find-merchandise.dto";
import { ResolveCreationAutofillDto } from "./dto/resolve-creation-autofill.dto";
import { UpdateMerchandiseDto } from "./dto/update-merchandise.dto";
import { InventoryService } from "./inventory.service";

@UseGuards(JwtAuthGuard, GroupsGuard, PermissionsGuard)
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

  @Get("catalogs/:catalogType")
  @RequireGroups()
  async getCatalogImportEntries(@Param("catalogType") catalogType: string) {
    return {
      items: await this.inventoryService.getCatalogImportEntries(catalogType),
    };
  }

  @Post("catalogs/:catalogType")
  @RequireGroups()
  async createCatalogEntry(
    @Param("catalogType") catalogType: string,
    @Body() createCatalogEntryDto: CreateCatalogEntryDto,
  ) {
    return {
      item: await this.inventoryService.createCatalogEntry(catalogType, createCatalogEntryDto),
    };
  }

  @Delete("catalogs/:catalogType/:codigo")
  @RequireGroups()
  async removeCatalogEntry(@Param("catalogType") catalogType: string, @Param("codigo") codigo: string) {
    return {
      item: await this.inventoryService.removeCatalogEntry(catalogType, codigo),
    };
  }

  @Post("catalogs/import/:catalogType")
  @RequireGroups()
  @RequirePermissions(CATALOG_IMPORT_EXCEL_PERMISSION_CODE)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async importCatalogFromExcel(
    @Param("catalogType") catalogType: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined,
  ) {
    return this.inventoryService.importCatalogFromExcel(catalogType, file);
  }

  @Get()
  async findAll(@Query() findMerchandiseDto: FindMerchandiseDto) {
    return this.inventoryService.searchMerchandise(findMerchandiseDto);
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

  @Patch(":codigoBarra")
  async update(
    @Param("codigoBarra") codigoBarra: string,
    @Body() updateMerchandiseDto: UpdateMerchandiseDto,
  ) {
    return {
      mercancia: await this.inventoryService.updateMerchandise(codigoBarra, updateMerchandiseDto),
    };
  }

  @Delete(":codigoBarra")
  async remove(@Param("codigoBarra") codigoBarra: string) {
    return {
      mercancia: await this.inventoryService.removeMerchandise(codigoBarra),
    };
  }
}

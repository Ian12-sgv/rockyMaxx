import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { CreateRoleDto } from "./dto/create-role.dto";
import { SetRoleCatalogImportAccessDto } from "./dto/set-role-catalog-import-access.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { RolesService } from "./roles.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin", "sistema")
@Controller("roles")
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async findAll() {
    return {
      roles: await this.rolesService.findAll(),
    };
  }

  @Get("permissions")
  async findPermissions() {
    return {
      permisos: await this.rolesService.findPermissions(),
    };
  }

  @Patch(":codGrupo/catalog-import-access")
  @RequireGroups("sistema")
  async setCatalogImportAccess(
    @Param("codGrupo") codGrupo: string,
    @Body() setRoleCatalogImportAccessDto: SetRoleCatalogImportAccessDto,
    @CurrentUser() currentUser: UserView,
  ) {
    return {
      rol: await this.rolesService.setCatalogImportAccess(
        codGrupo,
        setRoleCatalogImportAccessDto.enabled,
        currentUser,
      ),
    };
  }

  @Get(":codGrupo")
  async findOne(@Param("codGrupo") codGrupo: string) {
    return {
      rol: await this.rolesService.findOne(codGrupo),
    };
  }

  @Post()
  async create(@Body() createRoleDto: CreateRoleDto, @CurrentUser() currentUser: UserView) {
    return {
      rol: await this.rolesService.create(createRoleDto, currentUser),
    };
  }

  @Patch(":codGrupo")
  async update(
    @Param("codGrupo") codGrupo: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() currentUser: UserView,
  ) {
    return {
      rol: await this.rolesService.update(codGrupo, updateRoleDto, currentUser),
    };
  }

  @Delete(":codGrupo")
  async remove(@Param("codGrupo") codGrupo: string) {
    return {
      rol: await this.rolesService.remove(codGrupo),
    };
  }
}

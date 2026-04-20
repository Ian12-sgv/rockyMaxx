import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateRoleDto } from "./dto/create-role.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { RolesService } from "./roles.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
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

  @Get(":codGrupo")
  async findOne(@Param("codGrupo") codGrupo: string) {
    return {
      rol: await this.rolesService.findOne(codGrupo),
    };
  }

  @Post()
  async create(@Body() createRoleDto: CreateRoleDto) {
    return {
      rol: await this.rolesService.create(createRoleDto),
    };
  }

  @Patch(":codGrupo")
  async update(@Param("codGrupo") codGrupo: string, @Body() updateRoleDto: UpdateRoleDto) {
    return {
      rol: await this.rolesService.update(codGrupo, updateRoleDto),
    };
  }

  @Delete(":codGrupo")
  async remove(@Param("codGrupo") codGrupo: string) {
    return {
      rol: await this.rolesService.remove(codGrupo),
    };
  }
}
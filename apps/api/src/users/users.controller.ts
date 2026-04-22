import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserView } from "./user-view.util";
import { UsersService } from "./users.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin", "sistema")
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll() {
    return {
      usuarios: await this.usersService.findAll(),
    };
  }

  @Get("groups")
  async findGroups() {
    return {
      grupos: await this.usersService.findGroups(),
    };
  }

  @Get(":codUsuario")
  async findOne(@Param("codUsuario") codUsuario: string) {
    return {
      usuario: await this.usersService.findOne(codUsuario),
    };
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto, @CurrentUser() currentUser: UserView) {
    return {
      usuario: await this.usersService.create(createUserDto, currentUser),
    };
  }

  @Patch(":codUsuario")
  async update(
    @Param("codUsuario") codUsuario: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: UserView,
  ) {
    return {
      usuario: await this.usersService.update(codUsuario, updateUserDto, currentUser),
    };
  }

  @Delete(":codUsuario")
  async remove(@Param("codUsuario") codUsuario: string) {
    return {
      usuario: await this.usersService.remove(codUsuario),
    };
  }
}

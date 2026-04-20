import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { hashLegacyPassword } from "../auth/password.util";
import { isProtectedAdminRoleCode, isProtectedAdminUserCode } from "../shared/protected-admin.util";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { normalizeLegacyGroupCode } from "./user-groups.util";
import { userWithGroupsInclude, toUserView } from "./user-view.util";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const users = await this.prisma.usuarios.findMany({
      include: userWithGroupsInclude,
      orderBy: { CodUsuario: "asc" },
    });

    return users.map((user) => toUserView(user));
  }

  async findOne(codUsuario: string) {
    const user = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: codUsuario.trim() },
      include: userWithGroupsInclude,
    });

    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    return toUserView(user);
  }

  async findGroups() {
    const groups = await this.prisma.grupos.findMany({
      orderBy: { CodGrupo: "asc" },
    });

    return groups.map((group) => ({
      codigo: group.CodGrupo,
      nombre: group.NombreGrupo,
      protegidoAdmin: isProtectedAdminRoleCode(group.CodGrupo, this.configService),
    }));
  }

  async create(createUserDto: CreateUserDto) {
    const codUsuario = createUserDto.codUsuario.trim();
    const existing = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: codUsuario },
    });

    if (existing) {
      throw new ConflictException("El usuario ya existe");
    }

    const resolvedGroups = await this.resolveGroups(createUserDto.grupos);
    const passwordPepper = this.getPasswordPepper();

    const created = await this.prisma.usuarios.create({
      data: {
        CodUsuario: codUsuario,
        NombreUsuario: createUserDto.nombreUsuario?.trim() || codUsuario,
        Pasword: hashLegacyPassword(createUserDto.password, passwordPepper),
        Status: createUserDto.status ?? 1,
        usuarioGrupos: {
          create: resolvedGroups.map((group) => ({
            grupo: {
              connect: { CodGrupo: group.CodGrupo },
            },
          })),
        },
      },
      include: userWithGroupsInclude,
    });

    return toUserView(created);
  }

  async update(codUsuario: string, updateUserDto: UpdateUserDto) {
    const normalizedUser = codUsuario.trim();
    const existing = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: normalizedUser },
      include: userWithGroupsInclude,
    });

    if (!existing) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const groups = updateUserDto.grupos ? await this.resolveGroups(updateUserDto.grupos) : null;
    if (
      groups &&
      isProtectedAdminUserCode(normalizedUser, this.configService) &&
      !groups.some((group) => isProtectedAdminRoleCode(group.CodGrupo, this.configService))
    ) {
      throw new BadRequestException("El usuario admin debe conservar el rol admin");
    }

    const passwordPepper = this.getPasswordPepper();

    const updated = await this.prisma.$transaction(async (tx) => {
      if (groups) {
        await tx.usuarioGrupo.deleteMany({
          where: { CodUsuario: normalizedUser },
        });

        if (groups.length > 0) {
          await tx.usuarioGrupo.createMany({
            data: groups.map((group) => ({
              CodUsuario: normalizedUser,
              CodGrupo: group.CodGrupo,
            })),
          });
        }
      }

      return tx.usuarios.update({
        where: { CodUsuario: normalizedUser },
        data: {
          NombreUsuario: updateUserDto.nombreUsuario?.trim() ?? undefined,
          Pasword: updateUserDto.password
            ? hashLegacyPassword(updateUserDto.password, passwordPepper)
            : undefined,
          Status: updateUserDto.status ?? undefined,
        },
        include: userWithGroupsInclude,
      });
    });

    return toUserView(updated);
  }

  async remove(codUsuario: string) {
    const normalizedUser = codUsuario.trim();

    if (isProtectedAdminUserCode(normalizedUser, this.configService)) {
      throw new BadRequestException("El usuario admin no puede eliminarse");
    }

    const existing = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: normalizedUser },
      include: userWithGroupsInclude,
    });

    if (!existing) {
      throw new NotFoundException("Usuario no encontrado");
    }

    try {
      const deleted = await this.prisma.usuarios.delete({
        where: { CodUsuario: normalizedUser },
        include: userWithGroupsInclude,
      });

      return toUserView(deleted);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException("No se puede eliminar el usuario porque tiene movimientos asociados");
      }
      throw error;
    }
  }

  async ensureDefaultAdmin() {
    const username = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_USERNAME")?.trim();
    const password = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_PASSWORD")?.trim();
    const name = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_NAME")?.trim();
    const requestedGroup = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_GROUP", "admin");

    if (!username || !password) {
      return;
    }

    const [group] = await this.resolveGroups([requestedGroup]);
    const existingUser = await this.prisma.usuarios.findFirst({
      where: {
        CodUsuario: {
          equals: username,
          mode: "insensitive",
        },
      },
      include: userWithGroupsInclude,
    });

    if (!existingUser) {
      await this.prisma.usuarios.create({
        data: {
          CodUsuario: username,
          NombreUsuario: name || username,
          Pasword: hashLegacyPassword(password, this.getPasswordPepper()),
          Status: 1,
          usuarioGrupos: {
            create: [
              {
                grupo: {
                  connect: { CodGrupo: group.CodGrupo },
                },
              },
            ],
          },
        },
      });
      return;
    }

    const alreadyLinked = existingUser.usuarioGrupos.some((item) => item.CodGrupo === group.CodGrupo);
    if (!alreadyLinked) {
      await this.prisma.usuarioGrupo.create({
        data: {
          CodUsuario: existingUser.CodUsuario,
          CodGrupo: group.CodGrupo,
        },
      });
    }
  }

  private async resolveGroups(groupInputs: string[]) {
    if (!groupInputs || groupInputs.length === 0) {
      throw new BadRequestException("Debe indicar al menos un grupo");
    }

    const groups = await this.prisma.grupos.findMany({
      orderBy: { CodGrupo: "asc" },
    });

    return groupInputs.map((input) => {
      const normalizedInput = normalizeLegacyGroupCode(input);
      const match = groups.find((group) => {
        return (
          normalizeLegacyGroupCode(group.CodGrupo) === normalizedInput ||
          normalizeLegacyGroupCode(group.NombreGrupo) === normalizedInput
        );
      });

      if (!match) {
        throw new BadRequestException(`Grupo no valido: ${input}`);
      }

      return match;
    });
  }

  private getPasswordPepper() {
    return (
      this.configService.get<string>("AUTH_PASSWORD_PEPPER") ||
      this.configService.get<string>("JWT_SECRET", "rocky-maxx-local-secret")
    );
  }
}
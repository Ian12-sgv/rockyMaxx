import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { hashLegacyPassword } from "../auth/password.util";
import {
  getProtectedAdminRoleCode,
  getProtectedSystemRoleCode,
  isProtectedAdminRoleCode,
  isProtectedAdminUserCode,
  isProtectedSystemRoleCode,
  isProtectedSystemUserCode,
} from "../shared/protected-admin.util";
import {
  CATALOG_IMPORT_EXCEL_PERMISSION_CODE,
  CATALOG_IMPORT_EXCEL_PERMISSION_NAME,
  normalizePermissionCodeValue,
} from "../shared/permission-codes.util";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { normalizeLegacyGroupCode } from "./user-groups.util";
import { UserView, userWithGroupsInclude, toUserView } from "./user-view.util";

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
      protegidoSistema: isProtectedSystemRoleCode(group.CodGrupo, this.configService),
    }));
  }

  async create(createUserDto: CreateUserDto, actor?: UserView) {
    const codUsuario = createUserDto.codUsuario.trim();
    const existing = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: codUsuario },
    });

    if (existing) {
      throw new ConflictException("El usuario ya existe");
    }

    const resolvedGroups = await this.resolveGroups(createUserDto.grupos);
    const actorIsSystem = this.isSystemActor(actor);

    if (!actorIsSystem && resolvedGroups.some((group) => isProtectedSystemRoleCode(group.CodGrupo, this.configService))) {
      throw new ForbiddenException("Solo el usuario sistema puede asignar el rol sistema");
    }

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

  async update(codUsuario: string, updateUserDto: UpdateUserDto, actor?: UserView) {
    const normalizedUser = codUsuario.trim();
    const existing = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: normalizedUser },
      include: userWithGroupsInclude,
    });

    if (!existing) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const actorIsSystem = this.isSystemActor(actor);

    if (isProtectedSystemUserCode(normalizedUser, this.configService) && !actorIsSystem) {
      throw new ForbiddenException("Solo el usuario sistema puede modificar al usuario sistema");
    }

    const groups = updateUserDto.grupos ? await this.resolveGroups(updateUserDto.grupos) : null;
    if (
      groups &&
      !actorIsSystem &&
      groups.some((group) => isProtectedSystemRoleCode(group.CodGrupo, this.configService))
    ) {
      throw new ForbiddenException("Solo el usuario sistema puede asignar el rol sistema");
    }

    if (
      groups &&
      isProtectedAdminUserCode(normalizedUser, this.configService) &&
      !actorIsSystem &&
      !groups.some((group) => isProtectedAdminRoleCode(group.CodGrupo, this.configService))
    ) {
      throw new BadRequestException("El usuario admin debe conservar el rol admin");
    }

    if (
      groups &&
      isProtectedSystemUserCode(normalizedUser, this.configService) &&
      !groups.some((group) => isProtectedSystemRoleCode(group.CodGrupo, this.configService))
    ) {
      throw new BadRequestException("El usuario sistema debe conservar el rol sistema");
    }

    if (
      updateUserDto.status === 0 &&
      isProtectedAdminUserCode(normalizedUser, this.configService) &&
      !actorIsSystem
    ) {
      throw new BadRequestException("El usuario admin debe permanecer activo");
    }

    if (updateUserDto.status === 0 && isProtectedSystemUserCode(normalizedUser, this.configService)) {
      throw new BadRequestException("El usuario sistema debe permanecer activo");
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

    if (isProtectedSystemUserCode(normalizedUser, this.configService)) {
      throw new BadRequestException("El usuario sistema no puede eliminarse");
    }

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

  async ensureSystemOperator() {
    const username = this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_USERNAME", "sistema")?.trim() || "sistema";
    const password = this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_PASSWORD", "456789")?.trim() || "456789";
    const name = this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_NAME", "sistema")?.trim() || "sistema";
    const requestedGroup = getProtectedSystemRoleCode(this.configService);

    const group = await this.ensureSystemGroup(requestedGroup);
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

    if (existingUser.Status === 0) {
      await this.prisma.usuarios.update({
        where: { CodUsuario: existingUser.CodUsuario },
        data: { Status: 1 },
      });
    }
  }

  async ensureCatalogImportPermissionSetup() {
    const ensuredPermission = await this.ensureCatalogImportPermissionRecord();

    if (ensuredPermission.created) {
      await this.grantPermissionToRoleIfMissing(
        getProtectedAdminRoleCode(this.configService),
        ensuredPermission.codigo,
      );
    }

    return ensuredPermission.codigo;
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

  private isSystemActor(actor?: UserView) {
    return Boolean(
      actor?.grupos?.some((group) => isProtectedSystemRoleCode(group.codigo, this.configService)),
    );
  }

  private async ensureCatalogImportPermissionRecord() {
    const codigo = normalizePermissionCodeValue(CATALOG_IMPORT_EXCEL_PERMISSION_CODE);
    const existing = await this.prisma.seg.findUnique({
      where: { CodNodo: codigo },
    });

    if (existing) {
      return {
        codigo,
        created: false,
      };
    }

    const aggregates = await this.prisma.seg.aggregate({
      _max: {
        NumNodo: true,
        Orden: true,
      },
    });

    await this.prisma.seg.create({
      data: {
        CodNodo: codigo,
        NomNodo: CATALOG_IMPORT_EXCEL_PERMISSION_NAME,
        Nivel: 1,
        NumNodo: (aggregates._max.NumNodo ?? 0) + 1,
        NodoPadre: "",
        Imagen: BigInt(0),
        Forma: "ROLE_PERMISSION",
        Orden: (aggregates._max.Orden ?? 0) + 1,
        EsPadre: "N",
      },
    });

    return {
      codigo,
      created: true,
    };
  }

  private async grantPermissionToRoleIfMissing(roleCode: string, permissionCode: string) {
    const normalizedRoleCode = normalizeLegacyGroupCode(roleCode);
    const existingRole = await this.prisma.grupos.findFirst({
      where: {
        CodGrupo: {
          equals: normalizedRoleCode,
          mode: "insensitive",
        },
      },
    });

    if (!existingRole) {
      return;
    }

    const existingPermission = await this.prisma.grupoSeg.findUnique({
      where: {
        CodGrupo_CodNodo: {
          CodGrupo: existingRole.CodGrupo,
          CodNodo: permissionCode,
        },
      },
    });

    if (existingPermission) {
      return;
    }

    await this.prisma.grupoSeg.create({
      data: {
        CodGrupo: existingRole.CodGrupo,
        CodNodo: permissionCode,
        Ver: "S",
      },
    });
  }

  private async ensureSystemGroup(requestedGroup: string) {
    const normalizedGroupCode = normalizeLegacyGroupCode(requestedGroup);
    const groupName = this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_GROUP_NAME", "Sistema")?.trim() || "Sistema";

    const existingGroup = await this.prisma.grupos.findFirst({
      where: {
        CodGrupo: {
          equals: normalizedGroupCode,
          mode: "insensitive",
        },
      },
    });

    const group = existingGroup
      ? await this.prisma.grupos.update({
          where: { CodGrupo: existingGroup.CodGrupo },
          data: {
            NombreGrupo: existingGroup.NombreGrupo || groupName,
          },
        })
      : await this.prisma.grupos.create({
          data: {
            CodGrupo: normalizedGroupCode,
            NombreGrupo: groupName,
          },
        });

    const [permissions, currentPermissions] = await Promise.all([
      this.prisma.seg.findMany({
        select: { CodNodo: true },
        orderBy: { CodNodo: "asc" },
      }),
      this.prisma.grupoSeg.findMany({
        where: { CodGrupo: group.CodGrupo },
        select: { CodNodo: true },
      }),
    ]);

    const currentCodes = new Set(currentPermissions.map((item) => item.CodNodo));
    const missingPermissions = permissions
      .map((permission) => permission.CodNodo)
      .filter((permissionCode) => !currentCodes.has(permissionCode));

    if (missingPermissions.length > 0) {
      await this.prisma.grupoSeg.createMany({
        data: missingPermissions.map((permissionCode) => ({
          CodGrupo: group.CodGrupo,
          CodNodo: permissionCode,
          Ver: "S",
        })),
      });
    }

    return group;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { isProtectedAdminRoleCode } from "../shared/protected-admin.util";
import { normalizeLegacyGroupCode } from "../users/user-groups.util";
import { CreateRoleDto } from "./dto/create-role.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { normalizePermissionCode, roleWithRelationsInclude, toRoleView } from "./role-view.util";

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const roles = await this.prisma.grupos.findMany({
      include: roleWithRelationsInclude,
      orderBy: { CodGrupo: "asc" },
    });

    return roles.map((role) => toRoleView(role, this.configService));
  }

  async findOne(codGrupo: string) {
    const normalizedRoleCode = normalizeLegacyGroupCode(codGrupo);
    const role = await this.prisma.grupos.findFirst({
      where: {
        CodGrupo: {
          equals: normalizedRoleCode,
          mode: "insensitive",
        },
      },
      include: roleWithRelationsInclude,
    });

    if (!role) {
      throw new NotFoundException("Rol no encontrado");
    }

    return toRoleView(role, this.configService);
  }

  async findPermissions() {
    const permissions = await this.prisma.seg.findMany({
      orderBy: [{ Nivel: "asc" }, { Orden: "asc" }, { CodNodo: "asc" }],
    });

    return permissions.map((permission) => ({
      codigo: permission.CodNodo,
      nombre: permission.NomNodo,
      nivel: permission.Nivel,
      nodoPadre: permission.NodoPadre,
      forma: permission.Forma,
      orden: permission.Orden,
      esPadre: permission.EsPadre,
    }));
  }

  async create(createRoleDto: CreateRoleDto) {
    const codGrupo = normalizeLegacyGroupCode(createRoleDto.codGrupo);
    const existing = await this.prisma.grupos.findFirst({
      where: {
        CodGrupo: {
          equals: codGrupo,
          mode: "insensitive",
        },
      },
    });

    if (existing) {
      throw new ConflictException("El rol ya existe");
    }

    const resolvedPermissions = await this.resolvePermissions(createRoleDto.permisos ?? []);
    const created = await this.prisma.grupos.create({
      data: {
        CodGrupo: codGrupo,
        NombreGrupo: createRoleDto.nombreGrupo.trim(),
        grupoSeg: {
          create: resolvedPermissions.map((permission) => ({
            Ver: "S",
            seg: {
              connect: { CodNodo: permission.CodNodo },
            },
          })),
        },
      },
      include: roleWithRelationsInclude,
    });

    return toRoleView(created, this.configService);
  }

  async update(codGrupo: string, updateRoleDto: UpdateRoleDto) {
    const normalizedRoleCode = normalizeLegacyGroupCode(codGrupo);
    const existing = await this.prisma.grupos.findFirst({
      where: {
        CodGrupo: {
          equals: normalizedRoleCode,
          mode: "insensitive",
        },
      },
      include: roleWithRelationsInclude,
    });

    if (!existing) {
      throw new NotFoundException("Rol no encontrado");
    }

    const permissions = updateRoleDto.permisos
      ? await this.resolvePermissions(updateRoleDto.permisos)
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (permissions) {
        await tx.grupoSeg.deleteMany({
          where: { CodGrupo: existing.CodGrupo },
        });

        if (permissions.length > 0) {
          await tx.grupoSeg.createMany({
            data: permissions.map((permission) => ({
              CodGrupo: existing.CodGrupo,
              CodNodo: permission.CodNodo,
              Ver: "S",
            })),
          });
        }
      }

      return tx.grupos.update({
        where: { CodGrupo: existing.CodGrupo },
        data: {
          NombreGrupo: updateRoleDto.nombreGrupo?.trim() ?? undefined,
        },
        include: roleWithRelationsInclude,
      });
    });

    return toRoleView(updated, this.configService);
  }

  async remove(codGrupo: string) {
    const normalizedRoleCode = normalizeLegacyGroupCode(codGrupo);

    if (isProtectedAdminRoleCode(normalizedRoleCode, this.configService)) {
      throw new BadRequestException("El rol admin no puede eliminarse");
    }

    const existing = await this.prisma.grupos.findFirst({
      where: {
        CodGrupo: {
          equals: normalizedRoleCode,
          mode: "insensitive",
        },
      },
      include: roleWithRelationsInclude,
    });

    if (!existing) {
      throw new NotFoundException("Rol no encontrado");
    }

    try {
      const deleted = await this.prisma.grupos.delete({
        where: { CodGrupo: existing.CodGrupo },
        include: roleWithRelationsInclude,
      });

      return toRoleView(deleted, this.configService);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException("No se puede eliminar el rol porque tiene relaciones activas");
      }
      throw error;
    }
  }

  private async resolvePermissions(permissionCodes: string[]) {
    const normalizedCodes = Array.from(
      new Set(
        permissionCodes
          .map((code) => normalizePermissionCode(code))
          .filter((code) => code.length > 0),
      ),
    );

    if (normalizedCodes.length === 0) {
      return [];
    }

    const permissions = await this.prisma.seg.findMany({
      orderBy: { CodNodo: "asc" },
    });

    return normalizedCodes.map((code) => {
      const match = permissions.find(
        (permission) => normalizePermissionCode(permission.CodNodo) === code,
      );

      if (!match) {
        throw new BadRequestException(`Permiso no valido: ${code}`);
      }

      return match;
    });
  }
}
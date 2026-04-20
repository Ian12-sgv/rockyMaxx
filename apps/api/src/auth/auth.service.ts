import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { PrismaService } from "../prisma/prisma.service";
import { userWithGroupsInclude, UserView, toUserView } from "../users/user-view.util";
import { LoginDto } from "./dto/login.dto";
import { verifyLegacyPassword } from "./password.util";

export type AuthTokenPayload = {
  sub: string;
  groups: string[];
  nombreUsuario: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.validateCredentials(loginDto.usuario, loginDto.password);
    const payload: AuthTokenPayload = {
      sub: user.CodUsuario,
      groups: user.usuarioGrupos.map((item) => item.grupo.CodGrupo),
      nombreUsuario: user.NombreUsuario,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: "Bearer",
      usuario: toUserView(user),
    };
  }

  async getAuthenticatedUser(codUsuario: string): Promise<UserView> {
    const user = await this.prisma.usuarios.findUnique({
      where: { CodUsuario: codUsuario },
      include: userWithGroupsInclude,
    });

    if (!user || user.Status === 0) {
      throw new UnauthorizedException("Usuario no autorizado");
    }

    return toUserView(user);
  }

  private async validateCredentials(usuario: string, password: string) {
    const user = await this.prisma.usuarios.findFirst({
      where: {
        CodUsuario: {
          equals: usuario.trim(),
          mode: "insensitive",
        },
      },
      include: userWithGroupsInclude,
    });

    if (!user || user.Status === 0) {
      throw new UnauthorizedException("Usuario o clave inválidos");
    }

    const pepper = this.configService.get<string>("AUTH_PASSWORD_PEPPER") || this.configService.get<string>("JWT_SECRET", "rocky-maxx-local-secret");
    const validPassword = verifyLegacyPassword(user.Pasword, password, pepper);

    if (!validPassword) {
      throw new UnauthorizedException("Usuario o clave inválidos");
    }

    return user;
  }
}
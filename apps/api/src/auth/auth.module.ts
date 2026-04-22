import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GroupsGuard } from "./guards/groups.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET", "rocky-maxx-local-secret"),
        signOptions: {
          expiresIn: configService.get<string>("JWT_EXPIRES_IN", "12h") as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, GroupsGuard, PermissionsGuard],
  exports: [AuthService, JwtAuthGuard, GroupsGuard, PermissionsGuard, JwtModule],
})
export class AuthModule {}

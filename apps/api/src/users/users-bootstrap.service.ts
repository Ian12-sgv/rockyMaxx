import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { UsersService } from "./users.service";

@Injectable()
export class UsersBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(UsersBootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async onModuleInit() {
    const adminEnabled = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_ENABLED", "true");
    const systemEnabled = this.configService.get<string>("AUTH_BOOTSTRAP_SYSTEM_ENABLED", "true");

    await this.usersService.ensureCatalogImportPermissionSetup();

    if (adminEnabled.toLowerCase() === "true") {
      await this.usersService.ensureDefaultAdmin();
      this.logger.log("Usuario administrador inicial verificado");
    }

    if (systemEnabled.toLowerCase() === "true") {
      await this.usersService.ensureSystemOperator();
      this.logger.log("Usuario sistema inicial verificado");
    }
  }
}

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
    const enabled = this.configService.get<string>("AUTH_BOOTSTRAP_ADMIN_ENABLED", "true");

    if (enabled.toLowerCase() !== "true") {
      return;
    }

    await this.usersService.ensureDefaultAdmin();
    this.logger.log("Usuario administrador inicial verificado");
  }
}
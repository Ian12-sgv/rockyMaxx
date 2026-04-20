import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../prisma/prisma.service";

type HealthRow = {
  database: string;
  schema: string;
  user_name: string;
};

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async getHealth() {
    const result = await this.prisma.$queryRaw<HealthRow[]>`
      SELECT
        current_database() AS database,
        current_schema() AS schema,
        current_user AS user_name
    `;

    const [database] = result;

    return {
      status: "ok",
      app: "rocky-maxx-api",
      port: this.configService.get<number>("API_PORT", 3000),
      database,
    };
  }
}

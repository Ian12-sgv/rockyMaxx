import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { NodeIdentityService } from "../node-identity/node-identity.service";
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
    private readonly nodeIdentity: NodeIdentityService,
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
    const identity = this.nodeIdentity.get();

    return {
      status: "ok",
      app: "rocky-maxx-api",
      host: this.configService.get<string>("API_HOST", "0.0.0.0"),
      port: this.configService.get<number>("API_PORT", 3000),
      database,
      // Lo usa el registro de nodos de Central para confirmar que una URL es de quien dice ser.
      node: {
        nodeId: identity.nodeId,
        role: identity.role,
        instance: identity.isVpsInstance ? "vps" : "local",
        source: identity.source,
        conflict: identity.conflict,
      },
    };
  }
}

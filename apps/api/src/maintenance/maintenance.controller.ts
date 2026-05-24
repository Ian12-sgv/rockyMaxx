import { Controller, Get, Res, StreamableFile, UseGuards } from "@nestjs/common";
import { createReadStream } from "node:fs";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MaintenanceService } from "./maintenance.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin", "sistema")
@Controller("maintenance")
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get("export-info")
  async getExportInfo() {
    return {
      export: await this.maintenanceService.getExportInfo(),
    };
  }

  @Get("database-dump")
  async downloadDatabaseDump(@Res({ passthrough: true }) response: any) {
    const artifact = await this.maintenanceService.createDatabaseDump();

    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Rocky-Database", artifact.databaseName);
    response.setHeader("X-Rocky-Schema", artifact.schemaName);

    const stream = createReadStream(artifact.filePath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      artifact.cleanup();
    };

    stream.once("close", cleanup);
    stream.once("error", cleanup);
    response.once("close", cleanup);

    return new StreamableFile(stream);
  }
}

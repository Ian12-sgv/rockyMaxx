import { Module } from "@nestjs/common";

import { BodegaExportController } from "./bodega-export.controller";
import { BodegaExportService } from "./bodega-export.service";

@Module({
  controllers: [BodegaExportController],
  providers: [BodegaExportService],
})
export class BodegaExportModule {}

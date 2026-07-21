import { Module } from "@nestjs/common";

import { BodegaExportService } from "./bodega-export.service";

@Module({
  providers: [BodegaExportService],
})
export class BodegaExportModule {}

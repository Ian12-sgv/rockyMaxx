import { Module } from "@nestjs/common";

import { EtlSyncErrorsService } from "./etl-sync-errors.service";
import { EtlSyncRunsService } from "./etl-sync-runs.service";
import { EtlWatermarksService } from "./etl-watermarks.service";

@Module({
  providers: [EtlSyncRunsService, EtlSyncErrorsService, EtlWatermarksService],
  exports: [EtlSyncRunsService, EtlSyncErrorsService, EtlWatermarksService],
})
export class EtlModule {}

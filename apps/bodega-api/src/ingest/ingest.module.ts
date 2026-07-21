import { Module } from "@nestjs/common";

import { DimTiendasModule } from "../dim-tiendas/dim-tiendas.module";
import { EtlModule } from "../etl/etl.module";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";

@Module({
  imports: [DimTiendasModule, EtlModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}

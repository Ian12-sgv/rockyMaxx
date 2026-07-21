import { Module } from "@nestjs/common";

import { DimTiendasService } from "./dim-tiendas.service";

@Module({
  providers: [DimTiendasService],
  exports: [DimTiendasService],
})
export class DimTiendasModule {}

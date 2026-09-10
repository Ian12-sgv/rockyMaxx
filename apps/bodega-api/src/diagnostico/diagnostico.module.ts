import { Module } from "@nestjs/common";

import { DimTiendasModule } from "../dim-tiendas/dim-tiendas.module";
import { DiagnosticoController } from "./diagnostico.controller";
import { DiagnosticoService } from "./diagnostico.service";

@Module({
  imports: [DimTiendasModule],
  controllers: [DiagnosticoController],
  providers: [DiagnosticoService],
})
export class DiagnosticoModule {}

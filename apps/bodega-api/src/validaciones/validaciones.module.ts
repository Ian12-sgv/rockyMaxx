import { Module } from "@nestjs/common";

import { ValidacionesController } from "./validaciones.controller";
import { ValidacionesService } from "./validaciones.service";

@Module({
  controllers: [ValidacionesController],
  providers: [ValidacionesService],
})
export class ValidacionesModule {}

import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CajasController } from "./cajas.controller";
import { CajasService } from "./cajas.service";

@Module({
  imports: [AuthModule],
  controllers: [CajasController],
  providers: [CajasService],
})
export class CajasModule {}

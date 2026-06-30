import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TiposPagoController } from "./tipos-pago.controller";
import { TiposPagoService } from "./tipos-pago.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TiposPagoController],
  providers: [TiposPagoService],
  exports: [TiposPagoService],
})
export class TiposPagoModule {}
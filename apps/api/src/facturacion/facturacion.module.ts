import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { FacturacionController } from "./facturacion.controller";
import { FacturacionService } from "./facturacion.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FacturacionController],
  providers: [FacturacionService],
})
export class FacturacionModule {}

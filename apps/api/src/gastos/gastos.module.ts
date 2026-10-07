import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { GastosController } from "./gastos.controller";
import { GastosService } from "./gastos.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [GastosController],
  providers: [GastosService],
})
export class GastosModule {}

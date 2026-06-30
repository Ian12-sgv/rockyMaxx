import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { BancosController } from "./bancos.controller";
import { BancosService } from "./bancos.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BancosController],
  providers: [BancosService],
  exports: [BancosService],
})
export class BancosModule {}
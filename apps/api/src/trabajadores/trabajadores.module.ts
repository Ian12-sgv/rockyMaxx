import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { TrabajadoresController } from "./trabajadores.controller";
import { TrabajadoresService } from "./trabajadores.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TrabajadoresController],
  providers: [TrabajadoresService],
  exports: [TrabajadoresService],
})
export class TrabajadoresModule {}

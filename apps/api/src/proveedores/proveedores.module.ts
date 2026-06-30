import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ProveedoresController } from "./proveedores.controller";
import { ProveedoresService } from "./proveedores.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProveedoresController],
  providers: [ProveedoresService],
  exports: [ProveedoresService],
})
export class ProveedoresModule {}

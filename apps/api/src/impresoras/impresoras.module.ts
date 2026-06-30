import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ImpresorasController } from "./impresoras.controller";
import { ImpresorasService } from "./impresoras.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ImpresorasController],
  providers: [ImpresorasService],
  exports: [ImpresorasService],
})
export class ImpresorasModule {}

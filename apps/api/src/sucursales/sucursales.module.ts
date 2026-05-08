import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SucursalesController } from "./sucursales.controller";
import { SucursalesService } from "./sucursales.service";

@Module({
  imports: [AuthModule],
  controllers: [SucursalesController],
  providers: [SucursalesService],
})
export class SucursalesModule {}

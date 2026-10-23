import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DevolucionesRapidasController } from "./devoluciones-rapidas.controller";
import { DevolucionesRapidasService } from "./devoluciones-rapidas.service";

@Module({
  imports: [AuthModule],
  controllers: [DevolucionesRapidasController],
  providers: [DevolucionesRapidasService],
})
export class DevolucionesRapidasModule {}

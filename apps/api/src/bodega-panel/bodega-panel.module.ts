import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { BodegaPanelController } from "./bodega-panel.controller";
import { BodegaPanelService } from "./bodega-panel.service";

@Module({
  imports: [AuthModule],
  controllers: [BodegaPanelController],
  providers: [BodegaPanelService],
})
export class BodegaPanelModule {}

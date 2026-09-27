import { Global, Module } from "@nestjs/common";

import { PanelAuthController } from "./panel-auth.controller";
import { PanelAuthGuard } from "./panel-auth.guard";
import { PanelAuthService } from "./panel-auth.service";

// Global para que @UseGuards(PanelAuthGuard) funcione en ValidacionesModule y
// BalanceModule sin importar este modulo en cada uno.
@Global()
@Module({
  controllers: [PanelAuthController],
  providers: [PanelAuthService, PanelAuthGuard],
  exports: [PanelAuthService, PanelAuthGuard],
})
export class PanelAuthModule {}

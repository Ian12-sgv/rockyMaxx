import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { BodegaPanelService } from "./bodega-panel.service";

// Panel de todas las tiendas (bodega_datos): solo el rol "jefe" puede
// verlo. GroupsGuard siempre deja pasar a "sistema" ademas (bypass
// incondicional dentro del guard), pero admin y los demas roles quedan
// fuera -- pedido explicito del usuario.
@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("jefe")
@Controller("bodega-panel")
export class BodegaPanelController {
  constructor(private readonly bodegaPanelService: BodegaPanelService) {}

  @Get("resumen")
  async resumen(@Query("desde") desde?: string, @Query("hasta") hasta?: string) {
    return this.bodegaPanelService.obtenerResumen(desde, hasta);
  }
}

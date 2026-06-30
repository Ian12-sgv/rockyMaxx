import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { UserView } from "../users/user-view.util";
import { CreateFacturacionSaleDto } from "./dto/create-facturacion-sale.dto";
import { FacturacionService } from "./facturacion.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin", "caja")
@Controller("facturacion")
export class FacturacionController {
  constructor(private readonly facturacionService: FacturacionService) {}

  @Post("sales")
  async createSale(@Body() payload: CreateFacturacionSaleDto, @CurrentUser() user: UserView) {
    return {
      venta: await this.facturacionService.createSale(payload, user),
    };
  }
}

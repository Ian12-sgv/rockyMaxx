import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { UserView } from "../users/user-view.util";
import { CreateInvoiceReturnDto } from "./dto/create-invoice-return.dto";
import { InvoiceReturnsService } from "./invoice-returns.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin", "caja")
@Controller("invoice-returns")
export class InvoiceReturnsController {
  constructor(private readonly invoiceReturnsService: InvoiceReturnsService) {}

  @Get("open-sales")
  async listOpenCajaSales() {
    return this.invoiceReturnsService.listOpenCajaSales();
  }

  @Get("lookup/:serie/:numeroFactura")
  async lookupSale(@Param("serie") serie: string, @Param("numeroFactura") numeroFactura: string) {
    return this.invoiceReturnsService.lookupSaleForReturn(serie, numeroFactura);
  }

  @Get()
  async findReturns(@Query("serie") serie?: string, @Query("limit") limit?: string) {
    return this.invoiceReturnsService.searchReturns({ serie, limit });
  }

  @Get(":serie/:numeroDevolucion")
  async findReturn(@Param("serie") serie: string, @Param("numeroDevolucion") numeroDevolucion: string) {
    return this.invoiceReturnsService.findReturn(serie, numeroDevolucion);
  }

  @Post()
  async createReturn(@Body() payload: CreateInvoiceReturnDto, @CurrentUser() user: UserView) {
    return {
      devolucion: await this.invoiceReturnsService.createReturn(payload, user),
    };
  }
}

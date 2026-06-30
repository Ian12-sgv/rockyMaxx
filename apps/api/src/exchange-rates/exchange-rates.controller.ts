import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";

import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ExchangeRatesService } from "./exchange-rates.service";
import { UpdateManualExchangeRateDto } from "./dto/update-manual-exchange-rate.dto";

@UseGuards(JwtAuthGuard, GroupsGuard)
@Controller("exchange-rates")
export class ExchangeRatesController {
  constructor(private readonly exchangeRatesService: ExchangeRatesService) {}

  @Get("bcv-usd")
  @RequireGroups("admin", "caja")
  async getBcvUsdRate() {
    return this.exchangeRatesService.getBcvUsdRate();
  }

  @Get("manual")
  @RequireGroups("admin", "caja")
  async getManualRate() {
    return this.exchangeRatesService.getManualRate();
  }

  @Put("manual")
  @RequireGroups("admin", "sistema")
  async updateManualRate(@Body() payload: UpdateManualExchangeRateDto) {
    return this.exchangeRatesService.updateManualRate(payload);
  }
}

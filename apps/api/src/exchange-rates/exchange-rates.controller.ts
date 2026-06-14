import { Body, Controller, Get, Put } from "@nestjs/common";

import { ExchangeRatesService } from "./exchange-rates.service";
import { UpdateManualExchangeRateDto } from "./dto/update-manual-exchange-rate.dto";

@Controller("exchange-rates")
export class ExchangeRatesController {
  constructor(private readonly exchangeRatesService: ExchangeRatesService) {}

  @Get("bcv-usd")
  async getBcvUsdRate() {
    return this.exchangeRatesService.getBcvUsdRate();
  }

  @Get("manual")
  async getManualRate() {
    return this.exchangeRatesService.getManualRate();
  }

  @Put("manual")
  async updateManualRate(@Body() payload: UpdateManualExchangeRateDto) {
    return this.exchangeRatesService.updateManualRate(payload);
  }
}

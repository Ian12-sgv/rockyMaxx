import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module";
import { ExchangeRatesController } from "./exchange-rates.controller";
import { ExchangeRatesService } from "./exchange-rates.service";

@Module({
  imports: [PrismaModule],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}

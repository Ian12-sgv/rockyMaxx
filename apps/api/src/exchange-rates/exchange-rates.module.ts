import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ExchangeRatesController } from "./exchange-rates.controller";
import { ExchangeRatesService } from "./exchange-rates.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}

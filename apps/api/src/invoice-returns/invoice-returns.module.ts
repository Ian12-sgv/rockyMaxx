import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { InvoiceReturnsController } from "./invoice-returns.controller";
import { InvoiceReturnsService } from "./invoice-returns.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [InvoiceReturnsController],
  providers: [InvoiceReturnsService],
})
export class InvoiceReturnsModule {}

import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AdjustmentsController } from "./adjustments.controller";
import { AdjustmentsService } from "./adjustments.service";

@Module({
  imports: [AuthModule],
  controllers: [AdjustmentsController],
  providers: [AdjustmentsService],
})
export class AdjustmentsModule {}

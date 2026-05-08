import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { TransfersController } from "./transfers.controller";
import { TransfersService } from "./transfers.service";

@Module({
  imports: [AuthModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}

import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DevReturnsController } from "./dev-returns.controller";
import { DevReturnsService } from "./dev-returns.service";

@Module({
  imports: [AuthModule],
  controllers: [DevReturnsController],
  providers: [DevReturnsService],
})
export class DevReturnsModule {}

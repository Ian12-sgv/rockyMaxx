import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { UsersBootstrapService } from "./users-bootstrap.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, UsersBootstrapService],
  exports: [UsersService],
})
export class UsersModule {}
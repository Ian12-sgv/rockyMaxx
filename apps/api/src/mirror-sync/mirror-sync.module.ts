import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { MirrorSyncController } from "./mirror-sync.controller";
import { MirrorSyncService } from "./mirror-sync.service";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [MirrorSyncController],
  providers: [MirrorSyncService],
  exports: [MirrorSyncService],
})
export class MirrorSyncModule {}

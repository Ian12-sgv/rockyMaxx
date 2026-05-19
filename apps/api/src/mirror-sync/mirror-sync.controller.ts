import { Body, Controller, Post, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MirrorSyncService } from "./mirror-sync.service";

@UseGuards(JwtAuthGuard)
@Controller("mirror-sync")
export class MirrorSyncController {
  constructor(private readonly mirrorSyncService: MirrorSyncService) {}

  @Post("import")
  async importMirrorPayload(@Body() body: unknown) {
    return this.mirrorSyncService.importMirrorPayload(body);
  }
}

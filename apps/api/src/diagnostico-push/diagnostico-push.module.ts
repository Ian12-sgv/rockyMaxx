import { Module } from "@nestjs/common";

import { DiagnosticoPushService } from "./diagnostico-push.service";

@Module({
  providers: [DiagnosticoPushService],
})
export class DiagnosticoPushModule {}

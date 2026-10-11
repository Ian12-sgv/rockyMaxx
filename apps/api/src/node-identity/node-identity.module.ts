import { Global, Module } from "@nestjs/common";

import { NodeIdentityService } from "./node-identity.service";

@Global()
@Module({
  providers: [NodeIdentityService],
  exports: [NodeIdentityService],
})
export class NodeIdentityModule {}

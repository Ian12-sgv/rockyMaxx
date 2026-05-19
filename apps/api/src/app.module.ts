import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AdjustmentsModule } from "./adjustments/adjustments.module";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { DevReturnsModule } from "./dev-returns/dev-returns.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { MirrorSyncModule } from "./mirror-sync/mirror-sync.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RolesModule } from "./roles/roles.module";
import { SucursalesModule } from "./sucursales/sucursales.module";
import { TransfersModule } from "./transfers/transfers.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    PrismaModule,
    MirrorSyncModule,
    AdjustmentsModule,
    HealthModule,
    AuthModule,
    DevReturnsModule,
    UsersModule,
    RolesModule,
    InventoryModule,
    SucursalesModule,
    TransfersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

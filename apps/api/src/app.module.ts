import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AdjustmentsModule } from "./adjustments/adjustments.module";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { CajasModule } from "./cajas/cajas.module";
import { ClientesModule } from "./clientes/clientes.module";
import { DevReturnsModule } from "./dev-returns/dev-returns.module";
import { ExchangeRatesModule } from "./exchange-rates/exchange-rates.module";
import { FacturacionModule } from "./facturacion/facturacion.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MirrorSyncModule } from "./mirror-sync/mirror-sync.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RolesModule } from "./roles/roles.module";
import { SucursalesModule } from "./sucursales/sucursales.module";
import { TrabajadoresModule } from "./trabajadores/trabajadores.module";
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
    CajasModule,
    HealthModule,
    AuthModule,
    ClientesModule,
    DevReturnsModule,
    ExchangeRatesModule,
    FacturacionModule,
    UsersModule,
    RolesModule,
    InventoryModule,
    MaintenanceModule,
    SucursalesModule,
    TrabajadoresModule,
    TransfersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

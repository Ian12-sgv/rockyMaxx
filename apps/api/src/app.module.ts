import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AdjustmentsModule } from "./adjustments/adjustments.module";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { BancosModule } from "./bancos/bancos.module";
import { CajasModule } from "./cajas/cajas.module";
import { ClientesModule } from "./clientes/clientes.module";
import { ComprasModule } from "./compras/compras.module";
import { DevReturnsModule } from "./dev-returns/dev-returns.module";
import { ExchangeRatesModule } from "./exchange-rates/exchange-rates.module";
import { FacturacionModule } from "./facturacion/facturacion.module";
import { HealthModule } from "./health/health.module";
import { ImpresorasModule } from "./impresoras/impresoras.module";
import { InventoryModule } from "./inventory/inventory.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MirrorSyncModule } from "./mirror-sync/mirror-sync.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProveedoresModule } from "./proveedores/proveedores.module";
import { RolesModule } from "./roles/roles.module";
import { SucursalesModule } from "./sucursales/sucursales.module";
import { TiposPagoModule } from "./tipos-pago/tipos-pago.module";
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
    BancosModule,
    CajasModule,
    HealthModule,
    ImpresorasModule,
    AuthModule,
    ClientesModule,
    ComprasModule,
    DevReturnsModule,
    ExchangeRatesModule,
    FacturacionModule,
    UsersModule,
    RolesModule,
    InventoryModule,
    MaintenanceModule,
    ProveedoresModule,
    SucursalesModule,
    TiposPagoModule,
    TrabajadoresModule,
    TransfersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

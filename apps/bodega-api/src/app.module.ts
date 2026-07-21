import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppController } from "./app.controller";
import { DimTiendasModule } from "./dim-tiendas/dim-tiendas.module";
import { EtlModule } from "./etl/etl.module";
import { IngestModule } from "./ingest/ingest.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ValidacionesModule } from "./validaciones/validaciones.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    PrismaModule,
    DimTiendasModule,
    EtlModule,
    IngestModule,
    ValidacionesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

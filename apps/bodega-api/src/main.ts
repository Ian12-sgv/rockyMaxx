import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { PrismaService } from "./prisma/prisma.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);
  const port = Number(configService.get<string>("PORT", "3100"));
  const host = String(configService.get<string>("HOST", "0.0.0.0") || "0.0.0.0").trim() || "0.0.0.0";

  // Lotes de ingest van hasta BATCH_LIMIT=1000 filas por entidadDestino
  // (ver BodegaExportService); el default de body-parser (100kb) es
  // insuficiente y provoca 413 en el primer ciclo (snapshot inicial).
  app.useBodyParser("json", { limit: "20mb" });

  await prismaService.enableShutdownHooks(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  await app.listen(port, host);
}

bootstrap();

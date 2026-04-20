import "reflect-metadata";

import { existsSync } from "node:fs";
import { join } from "node:path";

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
  const port = Number(configService.get<string>("API_PORT", "3000"));
  const publicPath = resolvePublicPath();

  await prismaService.enableShutdownHooks(app);

  app.setGlobalPrefix("api");
  app.enableCors();
  if (publicPath) {
    app.useStaticAssets(publicPath);
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  await app.listen(port);
}

function resolvePublicPath() {
  const candidates = [join(process.cwd(), "public"), join(process.cwd(), "apps", "api", "public")];

  return candidates.find((candidate) => existsSync(candidate));
}

bootstrap();

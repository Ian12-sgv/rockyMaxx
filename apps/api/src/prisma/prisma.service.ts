import { INestApplication, Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      log: ["warn", "error"],
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.ensureRestoredDatabaseCompatibility();
  }

  private async ensureRestoredDatabaseCompatibility() {
    await this.$executeRawUnsafe(`
      ALTER TABLE IF EXISTS dbo."IMPUESTOS"
      ADD COLUMN IF NOT EXISTS "Status" INTEGER
    `);

    const impuestosTableExists = await this.$queryRawUnsafe<Array<{ exists: boolean }>>(`
      SELECT to_regclass('dbo."IMPUESTOS"') IS NOT NULL AS exists
    `);

    if (impuestosTableExists[0]?.exists) {
      const activeRows = await this.$queryRawUnsafe<Array<{ count: number }>>(`
        SELECT COUNT(*)::int AS count
        FROM dbo."IMPUESTOS"
        WHERE COALESCE("Status", 0) = 1
      `);

      if ((activeRows[0]?.count ?? 0) === 0) {
        const preferredRows = await this.$queryRawUnsafe<Array<{ Codigo: number }>>(`
          SELECT "Codigo"
          FROM dbo."IMPUESTOS"
          ORDER BY CASE WHEN "Codigo" = 1 THEN 0 ELSE 1 END, "Codigo" ASC
          LIMIT 1
        `);
        const preferredCode = preferredRows[0]?.Codigo;

        if (typeof preferredCode === "number") {
          await this.$executeRawUnsafe(
            `UPDATE dbo."IMPUESTOS" SET "Status" = CASE WHEN "Codigo" = ${preferredCode} THEN 1 ELSE 0 END`,
          );
        }
      } else {
        await this.$executeRawUnsafe(`
          UPDATE dbo."IMPUESTOS"
          SET "Status" = 0
          WHERE "Status" IS NULL
        `);
      }
    }

    const printerTableExists = await this.$queryRawUnsafe<Array<{ exists: boolean }>>(`
      SELECT to_regclass('dbo."IMPRESORAFISCAL"') IS NOT NULL AS exists
    `);

    if (printerTableExists[0]?.exists) {
      await this.$executeRawUnsafe(`
        INSERT INTO dbo."IMPRESORAFISCAL"
          ("ID", "NombreImpresora", "Status", "IdProcesoImpresion", "MontoMaximoDiario", "IncluyeIGTF")
        VALUES (0, 'NO APLICA', 1, 0, 99000000.00, FALSE)
        ON CONFLICT ("ID") DO NOTHING
      `);
    }

    await this.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS dbo."FACTURACION_IDEMPOTENCIA" (
        "RequestId" VARCHAR(64) PRIMARY KEY,
        "RespuestaJson" TEXT NULL,
        "CreadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.$executeRawUnsafe(`
      ALTER TABLE IF EXISTS dbo."DEVBORRADOR"
      ADD COLUMN IF NOT EXISTS "CodigoOrigen" VARCHAR(15)
    `);

    await this.$executeRawUnsafe(`
      ALTER TABLE IF EXISTS dbo."MOVVENTAS"
      ADD COLUMN IF NOT EXISTS "FormaPago" INTEGER
    `);

    await this.$executeRawUnsafe(`
      ALTER TABLE IF EXISTS dbo."FORMAPAGO"
      ADD COLUMN IF NOT EXISTS "EsDolar" BOOLEAN NOT NULL DEFAULT false
    `);

    await this.$executeRawUnsafe(`
      UPDATE dbo."FORMAPAGO"
      SET "EsDolar" = true
      WHERE "EsDolar" = false
        AND upper(regexp_replace(COALESCE("Nombre", ''), '[^A-Za-z0-9]', '', 'g'))
          IN ('EFECTIVODOLAR', 'DOLARELECTRONICO', 'USDT')
    `);
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on("beforeExit", async () => {
      await app.close();
    });
  }
}

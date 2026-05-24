import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PrismaService } from "../prisma/prisma.service";

const execFileAsync = promisify(execFile);

type ExportInfo = {
  databaseName: string;
  schemaName: string;
  userName: string;
  generatedAt: string;
  format: "custom";
};

type DumpArtifact = {
  fileName: string;
  filePath: string;
  databaseName: string;
  schemaName: string;
  cleanup: () => void;
};

type ParsedDatabaseUrl = {
  host: string;
  port: string;
  databaseName: string;
  userName: string;
  password: string;
};

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getExportInfo(): Promise<ExportInfo> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        database_name: string;
        schema_name: string;
        user_name: string;
      }>
    >('SELECT current_database()::text AS database_name, current_schema()::text AS schema_name, current_user::text AS user_name');

    const info = rows[0];
    if (!info) {
      throw new InternalServerErrorException("No se pudo resolver el contexto de exportacion.");
    }

    return {
      databaseName: info.database_name,
      schemaName: info.schema_name || "dbo",
      userName: info.user_name,
      generatedAt: new Date().toISOString(),
      format: "custom",
    };
  }

  async createDatabaseDump(): Promise<DumpArtifact> {
    const exportInfo = await this.getExportInfo();
    const connection = this.parseDatabaseUrl();
    const pgDumpPath = await this.resolvePostgresToolPath("pg_dump");
    const tempDirectory = mkdtempSync(join(tmpdir(), "rocky-maxx-export-"));
    const timestamp = this.formatTimestampForFileName(new Date());
    const baseName = this.sanitizeFileName(exportInfo.databaseName || connection.databaseName || "rocky");
    const fileName = `${baseName}-${timestamp}.dump`;
    const filePath = join(tempDirectory, fileName);

    try {
      await execFileAsync(
        pgDumpPath,
        [
          "--format=custom",
          "--schema=dbo",
          "--file",
          filePath,
          "--host",
          connection.host,
          "--port",
          connection.port,
          "--username",
          connection.userName,
          "--dbname",
          connection.databaseName,
        ],
        {
          env: {
            ...process.env,
            PGPASSWORD: connection.password,
          },
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
    } catch (error) {
      rmSync(tempDirectory, { recursive: true, force: true });
      const details = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`No se pudo generar el respaldo PostgreSQL: ${details}`);
    }

    return {
      fileName,
      filePath,
      databaseName: exportInfo.databaseName,
      schemaName: exportInfo.schemaName,
      cleanup: () => {
        rmSync(tempDirectory, { recursive: true, force: true });
      },
    };
  }

  private parseDatabaseUrl(): ParsedDatabaseUrl {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "").trim();
    if (!databaseUrl) {
      throw new InternalServerErrorException("DATABASE_URL no esta configurada.");
    }

    let parsed: URL;
    try {
      parsed = new URL(databaseUrl);
    } catch (error) {
      throw new InternalServerErrorException("DATABASE_URL no tiene un formato valido.");
    }

    const databaseName = parsed.pathname.replace(/^\/+/, "").trim();
    if (!databaseName) {
      throw new InternalServerErrorException("DATABASE_URL no incluye el nombre de la base de datos.");
    }

    return {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port || "5432",
      databaseName,
      userName: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
    };
  }

  private async resolvePostgresToolPath(toolName: "pg_dump"): Promise<string> {
    const configuredToolPath = String(this.configService.get<string>("PG_DUMP_PATH", "") || "").trim();
    if (configuredToolPath && existsSync(configuredToolPath)) {
      return configuredToolPath;
    }

    const toolExecutable = process.platform === "win32" ? `${toolName}.exe` : toolName;

    const fromPath = await this.resolveToolFromPath(toolExecutable);
    if (fromPath) {
      return fromPath;
    }

    for (const candidate of this.getFallbackToolCandidates(toolExecutable)) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new InternalServerErrorException(
      "No se encontro pg_dump en el servidor. Instala las herramientas PostgreSQL o define PG_DUMP_PATH.",
    );
  }

  private async resolveToolFromPath(toolExecutable: string): Promise<string | null> {
    const resolver = process.platform === "win32" ? "where" : "which";

    try {
      const { stdout } = await execFileAsync(resolver, [toolExecutable], {
        windowsHide: true,
      });
      const firstLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      return firstLine || null;
    } catch (_error) {
      return null;
    }
  }

  private getFallbackToolCandidates(toolExecutable: string): string[] {
    if (process.platform === "win32") {
      const baseDirectory = "C:\\Program Files\\PostgreSQL";
      if (!existsSync(baseDirectory)) {
        return [];
      }

      return readdirSync(baseDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => Number.parseInt(right, 10) - Number.parseInt(left, 10))
        .map((version) => join(baseDirectory, version, "bin", toolExecutable));
    }

    const linuxBaseDirectory = "/usr/lib/postgresql";
    const candidates = [join("/usr/bin", toolExecutable)];
    if (existsSync(linuxBaseDirectory)) {
      const versionCandidates = readdirSync(linuxBaseDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => Number.parseInt(right, 10) - Number.parseInt(left, 10))
        .map((version) => join(linuxBaseDirectory, version, "bin", toolExecutable));
      candidates.push(...versionCandidates);
    }

    return candidates;
  }

  private formatTimestampForFileName(value: Date) {
    const parts = [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
      String(value.getHours()).padStart(2, "0"),
      String(value.getMinutes()).padStart(2, "0"),
      String(value.getSeconds()).padStart(2, "0"),
    ];

    return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
  }

  private sanitizeFileName(value: string) {
    return String(value || "rocky")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }
}

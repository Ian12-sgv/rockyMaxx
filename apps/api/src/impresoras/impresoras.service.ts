import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { ContingenciaReportFormat, getContingenciaReportFormats } from "./contingencia-report-formats.util";
import { CreateImpresoraDto } from "./dto/create-impresora.dto";
import { FindImpresorasDto } from "./dto/find-impresoras.dto";
import { UpdateImpresoraDto } from "./dto/update-impresora.dto";
import { toImpresoraView } from "./impresora-view.util";

type ImpresoraFiscalRow = {
  ID: string | number | bigint;
  NombreImpresora: string | null;
  Status: number | null;
  IdProcesoImpresion: string | number | bigint | null;
  MontoMaximoDiario: string | number | null;
  IncluyeIGTF: boolean | null;
};

const DEFAULT_MONTO_MAXIMO_DIARIO = new Prisma.Decimal("99000000");

@Injectable()
export class ImpresorasService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata() {
    const rows = await this.findRows();
    const maxId = rows.reduce((max, item) => Math.max(max, this.normalizeIdValue(item.ID, 0)), 0);
    const reportFormats = getContingenciaReportFormats();

    return {
      defaults: {
        id: maxId + 1,
        status: 0,
        idProcesoImpresion: reportFormats[0]?.id ?? 0,
      },
      reportFormats,
    };
  }

  async findAll(findImpresorasDto: FindImpresorasDto) {
    const search = String(findImpresorasDto.buscar || "").trim().toLowerCase();
    const limit = findImpresorasDto.limit ?? 100;
    const items = (await this.findRows())
      .map((item) => toImpresoraView(item))
      .filter((item) => {
        if (typeof findImpresorasDto.status === "number" && item.status !== findImpresorasDto.status) {
          return false;
        }

        if (!search) {
          return true;
        }

        return `${item.id} ${item.nombreImpresora}`.toLowerCase().includes(search);
      })
      .sort((left, right) => left.id - right.id);

    return items.slice(0, limit);
  }

  async findOne(id: number | string) {
    const normalizedId = this.normalizeId(id);
    const row = await this.findRowById(normalizedId);
    if (!row) {
      throw new NotFoundException("Impresora no encontrada.");
    }

    return toImpresoraView(row);
  }

  async create(createImpresoraDto: CreateImpresoraDto) {
    const nombreImpresora = this.normalizeRequiredPrinterName(createImpresoraDto.nombreImpresora);
    const duplicate = await this.findRowByName(nombreImpresora);
    if (duplicate) {
      throw new ConflictException("Ya existe una impresora registrada con ese nombre.");
    }

    const metadata = await this.getMetadata();
    const reportFormats = Array.isArray(metadata.reportFormats) ? metadata.reportFormats : [];
    const id = this.normalizeIdValue(createImpresoraDto.id, metadata.defaults.id);
    const status = this.resolveStatus(createImpresoraDto.status);
    const idProcesoImpresion = this.resolveReportFormatId(
      createImpresoraDto.idProcesoImpresion,
      reportFormats,
      metadata.defaults.idProcesoImpresion,
    );

    const existing = await this.findRowById(id);
    if (existing) {
      throw new ConflictException("Ya existe una impresora registrada con ese identificador.");
    }

    await this.prisma.$executeRaw`
      INSERT INTO "dbo"."IMPRESORAFISCAL" (
        "ID",
        "NombreImpresora",
        "Status",
        "IdProcesoImpresion",
        "MontoMaximoDiario",
        "IncluyeIGTF"
      )
      VALUES (
        ${id},
        ${nombreImpresora},
        ${status},
        ${idProcesoImpresion},
        ${DEFAULT_MONTO_MAXIMO_DIARIO},
        ${false}
      )
    `;

    const created = await this.findRowById(id);
    if (!created) {
      throw new ConflictException("No se pudo registrar la impresora.");
    }

    return toImpresoraView(created);
  }

  async update(id: number | string, updateImpresoraDto: UpdateImpresoraDto) {
    const normalizedId = this.normalizeId(id);
    const existing = await this.findRowById(normalizedId);
    if (!existing) {
      throw new NotFoundException("Impresora no encontrada.");
    }

    const nombreImpresora = this.normalizeRequiredPrinterName(updateImpresoraDto.nombreImpresora);
    const duplicate = await this.findRowByName(nombreImpresora);
    if (duplicate && this.normalizeIdValue(duplicate.ID, -1) !== normalizedId) {
      throw new ConflictException("Ya existe otra impresora registrada con ese nombre.");
    }

    const status = this.resolveStatus(updateImpresoraDto.status);
    const reportFormats = getContingenciaReportFormats();
    const existingReportFormatId = this.normalizeIdValue(existing.IdProcesoImpresion, reportFormats[0]?.id ?? 0);
    const idProcesoImpresion = this.resolveReportFormatId(
      updateImpresoraDto.idProcesoImpresion,
      reportFormats,
      existingReportFormatId,
    );

    await this.prisma.$executeRaw`
      UPDATE "dbo"."IMPRESORAFISCAL"
      SET
        "NombreImpresora" = ${nombreImpresora},
        "Status" = ${status},
        "IdProcesoImpresion" = ${idProcesoImpresion}
      WHERE "ID" = ${normalizedId}
    `;

    const updated = await this.findRowById(normalizedId);
    if (!updated) {
      throw new NotFoundException("Impresora no encontrada.");
    }

    return toImpresoraView(updated);
  }

  async remove(id: number | string) {
    const normalizedId = this.normalizeId(id);
    const existing = await this.findRowById(normalizedId);
    if (!existing) {
      throw new NotFoundException("Impresora no encontrada.");
    }

    try {
      await this.prisma.$executeRaw`
        DELETE FROM "dbo"."IMPRESORAFISCAL"
        WHERE "ID" = ${normalizedId}
      `;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
        throw new ConflictException("No se puede eliminar la impresora porque esta relacionada con otras configuraciones.");
      }

      throw error;
    }
  }

  private async findRows() {
    return this.prisma.$queryRaw<ImpresoraFiscalRow[]>`
      SELECT
        "ID",
        "NombreImpresora",
        "Status",
        "IdProcesoImpresion",
        "MontoMaximoDiario",
        "IncluyeIGTF"
      FROM "dbo"."IMPRESORAFISCAL"
      ORDER BY "ID" ASC
    `;
  }

  private async findRowById(id: number) {
    const rows = await this.prisma.$queryRaw<ImpresoraFiscalRow[]>`
      SELECT
        "ID",
        "NombreImpresora",
        "Status",
        "IdProcesoImpresion",
        "MontoMaximoDiario",
        "IncluyeIGTF"
      FROM "dbo"."IMPRESORAFISCAL"
      WHERE "ID" = ${id}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  private async findRowByName(nombreImpresora: string) {
    const normalized = nombreImpresora.trim().toLowerCase();
    const rows = await this.findRows();

    return rows.find((item) => String(item.NombreImpresora || "").trim().toLowerCase() === normalized) ?? null;
  }

  private normalizeId(value: number | string) {
    const normalized = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isInteger(normalized) || normalized < 0) {
      throw new BadRequestException("Debes indicar un identificador valido para la impresora.");
    }

    return normalized;
  }

  private normalizeIdValue(value: string | number | bigint | null | undefined, fallback: number) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }

    const normalized = Number.parseInt(String(value).trim(), 10);
    return Number.isInteger(normalized) ? normalized : fallback;
  }

  private normalizeRequiredPrinterName(value: string | undefined) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      throw new BadRequestException("Debes seleccionar una impresora detectada.");
    }

    return normalized;
  }

  private resolveStatus(value?: number) {
    return Number(value ?? 0) === 1 ? 1 : 0;
  }

  private resolveReportFormatId(
    value: number | undefined,
    reportFormats: ContingenciaReportFormat[],
    fallback: number,
  ) {
    if (!reportFormats.length) {
      return 0;
    }

    const normalized = Number.parseInt(String(value ?? "").trim(), 10);
    if (Number.isInteger(normalized) && reportFormats.some((item) => item.id === normalized)) {
      return normalized;
    }

    return reportFormats.some((item) => item.id === fallback) ? fallback : reportFormats[0].id;
  }
}

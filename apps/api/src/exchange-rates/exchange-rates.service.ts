import { BadRequestException, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { UpdateManualExchangeRateDto } from "./dto/update-manual-exchange-rate.dto";

type ManualRateRow = {
  ID: number;
  Fecha: Date | string;
  Valor: unknown;
};

type ManualRateSnapshot = {
  valorCambio: number;
  valorMayor: number;
  actualizadoEn: string;
};

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getBcvUsdRate() {
    const snapshot = await this.getManualRateSnapshot();
    return {
      source: "MANUAL",
      provider: "Registro manual",
      providerUrl: "",
      fallbackUsed: false,
      rateBsPerUsd: snapshot.valorCambio,
      rateMayor: snapshot.valorMayor,
      effectiveDate: snapshot.actualizadoEn.slice(0, 10),
      fetchedAt: snapshot.actualizadoEn,
    };
  }

  async getManualRate() {
    const snapshot = await this.getManualRateSnapshot();
    return {
      item: {
        valorCambio: this.toDecimalInputValue(snapshot.valorCambio),
        valorMayor: this.toDecimalInputValue(snapshot.valorMayor),
        actualizadoEn: snapshot.actualizadoEn,
      },
    };
  }

  async updateManualRate(payload: UpdateManualExchangeRateDto) {
    const valorCambio = this.normalizeDecimalInput(payload.valorCambio, "valor del cambio");
    const valorMayor = this.normalizeDecimalInput(payload.valorMayor, "valor del mayor");
    const valorCambioStorage = this.toStorageRateValue(valorCambio);
    const valorMayorStorage = this.toStorageRateValue(valorMayor);
    const now = new Date();

    const [detalleRow, mayorRow] = await this.prisma.$transaction([
      this.prisma.$queryRawUnsafe<ManualRateRow[]>(
        `
          INSERT INTO dbo."TASA_CAMBIO" ("Valor", "Fecha")
          VALUES ($1::numeric, $2::timestamp)
          RETURNING "ID", "Fecha", "Valor"
        `,
        valorCambioStorage,
        now,
      ),
      this.prisma.$queryRawUnsafe<ManualRateRow[]>(
        `
          INSERT INTO dbo."TASA_CAMBIO_M" ("Valor", "Fecha")
          VALUES ($1::numeric, $2::timestamp)
          RETURNING "ID", "Fecha", "Valor"
        `,
        valorMayorStorage,
        now,
      ),
    ]);

    const detalle = detalleRow[0];
    const mayor = mayorRow[0];
    const updatedAt = this.getMostRecentDate([detalle?.Fecha, mayor?.Fecha]);

    return {
      item: {
        valorCambio: this.toDecimalInputValue(this.toDisplayRateValue(detalle?.Valor ?? valorCambioStorage)),
        valorMayor: this.toDecimalInputValue(this.toDisplayRateValue(mayor?.Valor ?? valorMayorStorage)),
        actualizadoEn: updatedAt,
      },
    };
  }

  private async getManualRateSnapshot(): Promise<ManualRateSnapshot> {
    const [detalle, mayor] = await Promise.all([
      this.getLatestRateRow("TASA_CAMBIO"),
      this.getLatestRateRow("TASA_CAMBIO_M"),
    ]);

    return {
      valorCambio: this.toDisplayRateValue(detalle?.Valor),
      valorMayor: this.toDisplayRateValue(mayor?.Valor),
      actualizadoEn: this.getMostRecentDate([detalle?.Fecha, mayor?.Fecha]),
    };
  }

  private async getLatestRateRow(tableName: "TASA_CAMBIO" | "TASA_CAMBIO_M") {
    const rows = await this.prisma.$queryRawUnsafe<ManualRateRow[]>(
      `
        SELECT "ID", "Fecha", "Valor"
        FROM dbo."${tableName}"
        ORDER BY "ID" DESC
        LIMIT 1
      `,
    );

    return rows[0] ?? null;
  }

  private normalizeDecimalInput(value: string, label: string) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      throw new BadRequestException(`Debes indicar el ${label}.`);
    }

    const parsed = this.parseDecimalInput(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException(`El ${label} no es valido.`);
    }

    return parsed.toFixed(2);
  }

  private parseDecimalInput(value: string) {
    const sanitized = String(value ?? "").trim().replace(/\s+/g, "");
    if (!sanitized) {
      return Number.NaN;
    }

    const commaIndex = sanitized.lastIndexOf(",");
    const dotIndex = sanitized.lastIndexOf(".");
    let normalized = sanitized;

    if (commaIndex >= 0 && dotIndex >= 0) {
      normalized = commaIndex > dotIndex ? sanitized.replace(/\./g, "").replace(",", ".") : sanitized.replace(/,/g, "");
    } else if (commaIndex >= 0) {
      normalized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = sanitized.replace(/,/g, "");
    }

    return Number(normalized);
  }

  private toFiniteNumber(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toDecimalInputValue(value: unknown) {
    const parsed = this.toFiniteNumber(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  }

  private toDisplayRateValue(value: unknown) {
    return this.toFiniteNumber(value);
  }

  private toStorageRateValue(value: string) {
    return this.toFiniteNumber(value).toFixed(2);
  }

  private getMostRecentDate(values: Array<Date | string | null | undefined>) {
    const entries = values
      .map((value) => ({
        raw: value,
        timestamp: this.toTimestamp(value),
      }))
      .filter((entry) => entry.timestamp !== null);

    if (entries.length === 0) {
      return "";
    }

    entries.sort((left, right) => Number(right.timestamp) - Number(left.timestamp));
    return this.formatTimestampWithoutTimezone(entries[0]?.raw);
  }

  private toTimestamp(value: Date | string | null | undefined) {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  private formatTimestampWithoutTimezone(value: Date | string | null | undefined) {
    if (!value) {
      return "";
    }

    if (typeof value === "string") {
      const normalized = value.trim().replace(" ", "T").replace(/Z$/i, "");
      return normalized;
    }

    const year = value.getUTCFullYear();
    const month = this.padTimestampPart(value.getUTCMonth() + 1);
    const day = this.padTimestampPart(value.getUTCDate());
    const hours = this.padTimestampPart(value.getUTCHours());
    const minutes = this.padTimestampPart(value.getUTCMinutes());
    const seconds = this.padTimestampPart(value.getUTCSeconds());
    const milliseconds = String(value.getUTCMilliseconds()).padStart(3, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  private padTimestampPart(value: number) {
    return String(value).padStart(2, "0");
  }
}

import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const decimalPattern = /^-?\d+(\.\d+)?$/;

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

function toUpperTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

function toOptionalNumericString(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return String(value).trim();
}

function toOptionalBoolean(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "si", "s"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return value;
}

function toOptionalInt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return Number.parseInt(String(value).trim(), 10);
}

export class CreateMerchandiseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoBarra!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Transform(({ value }) => toTrimmedString(value))
  referencia!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Transform(({ value }) => toTrimmedString(value))
  nombre!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoMarca!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  nombreMarca?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(6)
  @Transform(({ value }) => toUpperTrimmedString(value))
  talla!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(3)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoColor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => toTrimmedString(value))
  nombreColor?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(12)
  @Transform(({ value }) => toUpperTrimmedString(value))
  fabricante!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => toTrimmedString(value))
  nombreFabricante?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  @Transform(({ value }) => toUpperTrimmedString(value))
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => toTrimmedString(value))
  nombreCategoria?: string;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => toOptionalInt(value))
  tipoImpuesto?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => toTrimmedString(value))
  nombreImpuesto?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  porcentajeImpuesto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => toTrimmedString(value))
  nota?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  precioDetal?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  precioMayor?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  precioAfiliado?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  precioPromocion?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toOptionalBoolean(value))
  promocion?: boolean;

  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) => toTrimmedString(value))
  fechaInicial?: string;

  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) => toTrimmedString(value))
  fechaFinal?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  costoInicial?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  costoPromedio?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  ultimoCosto?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  costoDolar?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  existenciaInicial?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  existencia?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  puntoReorden?: string;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => toOptionalInt(value))
  tipo?: number;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => toOptionalInt(value))
  status?: number;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => toOptionalInt(value))
  serializado?: number;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoBarraAnt?: string;
}

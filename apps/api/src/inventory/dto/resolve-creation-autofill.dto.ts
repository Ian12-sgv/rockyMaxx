import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const decimalPattern = /^-?\d+(\.\d+)?$/;

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

function toUpperTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

function toOptionalInt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return Number.parseInt(String(value).trim(), 10);
}

function toOptionalNumericString(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return String(value).trim();
}

export class ResolveCreationAutofillDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoMarca?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  nombreMarca?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(6)
  @Transform(({ value }) => toUpperTrimmedString(value))
  talla?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(3)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => toTrimmedString(value))
  nombreColor?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  @Transform(({ value }) => toUpperTrimmedString(value))
  fabricante?: string;

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
}

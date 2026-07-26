import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalTrimmedString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

function toBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "si", "sí", "s", "on"].includes(normalized);
}

export class FacturacionSaleItemDto {
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare codigoBarra: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare priceList?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare precio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cantidad?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare subtotal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare descuentoPorcentaje?: string;
}

export class FacturacionPaymentRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare formaPago?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare monto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cedula?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare documento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare lote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare banco?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare puntoVenta?: string;
}

export class CreateFacturacionSaleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare requestId?: string;

  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare clienteCodigo: string;

  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare vendedorCedula: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toBooleanValue(value))
  declare emisionContingencia?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toBooleanValue(value))
  declare overrideDiscountAuthorized?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toBooleanValue(value))
  declare overrideDiscountActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare overrideDiscountPercent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare tasaCambio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare tasaCambioMayor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare serieCaja?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FacturacionSaleItemDto)
  declare items: FacturacionSaleItemDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FacturacionPaymentRowDto)
  declare pagos: FacturacionPaymentRowDto[];
}

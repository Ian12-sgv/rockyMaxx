import { Transform, Type } from "class-transformer";
import {
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

import {
  decimalPattern,
  toOptionalBoolean,
  toOptionalInt,
  toOptionalNumericString,
  toTrimmedString,
  toUpperTrimmedString,
} from "./merchandise-dto.helpers";

class MerchandiseGeneralSectionDto {
  @IsOptional()
  categoria?: unknown;

  @IsOptional()
  fabricante?: unknown;

  @IsOptional()
  marca?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => toTrimmedString(value))
  familia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value }) => toTrimmedString(value))
  nombre?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  puntoRecorte?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => toTrimmedString(value))
  nota?: string;

  @IsOptional()
  tipo?: unknown;

  @IsOptional()
  status?: unknown;
}

class MerchandiseSizesColorsSectionDto {
  @IsOptional()
  talla?: unknown;

  @IsOptional()
  colores?: unknown;

  @IsOptional()
  color?: unknown;
}

class MerchandisePromotionSectionDto {
  @IsOptional()
  activa?: unknown;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  porcentajeDescuento?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  precio?: string;

  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) => toTrimmedString(value))
  desde?: string;

  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) => toTrimmedString(value))
  hasta?: string;
}

class MerchandisePricesSectionDto {
  @IsOptional()
  impuesto?: unknown;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  detal?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  mayor?: string;

  @IsOptional()
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  afiliado?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MerchandisePromotionSectionDto)
  promocion?: MerchandisePromotionSectionDto;
}

export class MerchandisePayloadDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => MerchandiseGeneralSectionDto)
  general?: MerchandiseGeneralSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MerchandiseSizesColorsSectionDto)
  tallasColores?: MerchandiseSizesColorsSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MerchandisePricesSectionDto)
  precios?: MerchandisePricesSectionDto;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoBarra?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoBarraAnt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Transform(({ value }) => toTrimmedString(value))
  referencia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => toTrimmedString(value))
  familia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value }) => toTrimmedString(value))
  nombre?: string;

  @IsOptional()
  marca?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoMarca?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => toTrimmedString(value))
  nombreMarca?: string;

  @IsOptional()
  talla?: unknown;

  @IsOptional()
  color?: unknown;

  @IsOptional()
  colores?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => toTrimmedString(value))
  nombreColor?: string;

  @IsOptional()
  fabricante?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoFabricante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => toTrimmedString(value))
  nombreFabricante?: string;

  @IsOptional()
  categoria?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(6)
  @Transform(({ value }) => toUpperTrimmedString(value))
  codigoCategoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => toTrimmedString(value))
  nombreCategoria?: string;

  @IsOptional()
  impuesto?: unknown;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => toOptionalInt(value))
  tipoImpuesto?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
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
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  porcentajeDescuento?: string;

  @IsOptional()
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
  @Matches(decimalPattern)
  @Transform(({ value }) => toOptionalNumericString(value))
  puntoRecorte?: string;

  @IsOptional()
  tipo?: unknown;

  @IsOptional()
  status?: unknown;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => toOptionalInt(value))
  serializado?: number;
}

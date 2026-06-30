import { Transform, Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString, toUpperTrimmedString } from "./caja-dto.helpers";

export class CreateCajaDto {
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare serie: string;

  @Type(() => Date)
  @IsDate()
  declare fecha: Date;

  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare numeroCaja: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare facturaInicial?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare ultimaFactura?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare horaApertura?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare horaCierre?: string;
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare nombreImpresora?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;
}


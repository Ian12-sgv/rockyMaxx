import { Transform, Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString, toTrimmedString } from "./cliente-dto.helpers";

export class CreateClienteDto {
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare codigo: string;

  @IsString()
  @MaxLength(120)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare nombre: string;

  @Type(() => Date)
  @IsDate()
  declare fechaIngreso: Date;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare direccion?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare tipo: number;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare tipoContribuyente: number;
}

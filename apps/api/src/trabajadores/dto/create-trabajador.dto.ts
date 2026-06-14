import { Transform, Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString, toTrimmedString } from "./trabajador-dto.helpers";

export class CreateTrabajadorDto {
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare cedula: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare codigo?: number;

  @IsString()
  @MaxLength(70)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare nombre: string;

  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare cargo: string;

  @Type(() => Date)
  @IsDate()
  declare fechaIngreso: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  declare fechaNacimiento?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare celular?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;
}

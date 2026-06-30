import { Transform, Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString, toTrimmedString } from "./proveedor-dto.helpers";

export class CreateProveedorDto {
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare codigo: string;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare tipo: number;

  @IsString()
  @MaxLength(120)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare contacto?: string;

  @Type(() => Date)
  @IsDate()
  declare fechaIngreso: Date;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare codigoPostal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare fax?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare pais?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare estado?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare ciudad?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;
}

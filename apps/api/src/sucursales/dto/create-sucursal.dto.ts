import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString, toUpperTrimmedString } from "./branch-dto.helpers";

export class CreateSucursalDto {
  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare telefono?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare porcentajeDeRedondeo?: string;
}

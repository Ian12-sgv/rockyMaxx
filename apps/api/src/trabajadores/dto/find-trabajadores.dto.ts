import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./trabajador-dto.helpers";

export class FindTrabajadoresDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare buscar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

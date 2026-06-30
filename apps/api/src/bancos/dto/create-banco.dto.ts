import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toTrimmedString } from "../banco-dto.helpers";

export class CreateBancoDto {
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare codigo: string;

  @IsString()
  @MaxLength(120)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare nombre: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;
}

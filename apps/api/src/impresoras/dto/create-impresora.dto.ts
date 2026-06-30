import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toTrimmedString } from "../impresora-dto.helpers";

export class CreateImpresoraDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare id?: number;

  @IsString()
  @MaxLength(255)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare nombreImpresora: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;
}

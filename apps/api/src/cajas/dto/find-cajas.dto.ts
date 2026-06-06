import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./caja-dto.helpers";

export class FindCajasDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare buscar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

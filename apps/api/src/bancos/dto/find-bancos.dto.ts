import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "../banco-dto.helpers";

export class FindBancosDto {
  @IsOptional()
  @IsString()
  @Type(() => String)
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
  @Max(100)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

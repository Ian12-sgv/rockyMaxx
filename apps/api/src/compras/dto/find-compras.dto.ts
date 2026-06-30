import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./compras-dto.helpers";

export class FindComprasDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare buscar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}


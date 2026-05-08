import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./branch-dto.helpers";

export class FindSucursalesDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare buscar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;
}

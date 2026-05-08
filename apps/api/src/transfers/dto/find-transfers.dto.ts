import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./transfer-dto.helpers";

export class FindTransfersDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
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
  @Max(100)
  @Type(() => Number)
  declare limit?: number;
}

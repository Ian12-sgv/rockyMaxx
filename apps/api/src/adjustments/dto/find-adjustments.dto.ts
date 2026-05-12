import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./adjustment-dto.helpers";

export class FindAdjustmentsDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare buscar?: string;

  @IsOptional()
  @IsIn(["positivo", "negativo", 1, -1, "1", "-1"])
  declare tipo?: "positivo" | "negativo" | 1 | -1 | "1" | "-1";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

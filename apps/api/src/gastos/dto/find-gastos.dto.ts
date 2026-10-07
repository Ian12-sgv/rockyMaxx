import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from "class-validator";

import { toOptionalBoolean, toOptionalInteger, toOptionalTrimmedString } from "../gasto-dto.helpers";

export class FindGastosDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "La fecha desde debe tener formato AAAA-MM-DD." })
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare desde?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "La fecha hasta debe tener formato AAAA-MM-DD." })
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare hasta?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toOptionalBoolean(value))
  declare incluirAnulados?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

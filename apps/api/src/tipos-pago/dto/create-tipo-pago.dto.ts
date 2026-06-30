import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toTrimmedString } from "../tipo-pago-dto.helpers";

export class CreateTipoPagoDto {
  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare codigo: number;

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

import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toTrimmedString } from "../tipo-pago-dto.helpers";

function toBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "si", "sí", "s", "on"].includes(normalized);
}

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

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toBooleanValue(value))
  declare esDolar?: boolean;
}

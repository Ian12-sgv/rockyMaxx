import { Transform, Type } from "class-transformer";
import { IsString, MaxLength } from "class-validator";

function toTrimmedString(value: unknown) {
  return String(value ?? "").trim();
}

export class UpdateManualExchangeRateDto {
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare valorCambio: string;

  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare valorMayor: string;
}

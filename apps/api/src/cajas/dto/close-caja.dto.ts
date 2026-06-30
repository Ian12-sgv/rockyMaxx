import { Transform, Type } from "class-transformer";
import { IsOptional, IsString, Matches } from "class-validator";
import { toOptionalTrimmedString } from "./caja-dto.helpers";
export class CloseCajaDto {
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare horaCierre?: string;
}

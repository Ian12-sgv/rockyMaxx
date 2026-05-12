import { Transform, Type } from "class-transformer";
import { IsDate, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

import {
  toOptionalInteger,
  toOptionalTrimmedString,
  toUpperTrimmedString,
} from "./dev-return-dto.helpers";

export class ApproveDevReturnDto {
  @IsString()
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoEnvia: string;

  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoRecibe: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare codigoOrigen?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  declare fechaEmision?: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare interContable?: number;

  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare idLote: number;
}

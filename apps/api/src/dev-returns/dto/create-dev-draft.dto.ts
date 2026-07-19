import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import {
  toOptionalInteger,
  toOptionalTrimmedString,
  toUpperTrimmedString,
} from "./dev-return-dto.helpers";

export class CreateDevDraftLineDto {
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cantidad: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare numeroCaja?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare costo?: string;
}

export class CreateDevDraftDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  declare fecha?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoOrigen?: string;

  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoDestino: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare observacion?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDevDraftLineDto)
  declare items: CreateDevDraftLineDto[];
}

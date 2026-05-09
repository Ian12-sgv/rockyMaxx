import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
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
} from "./transfer-dto.helpers";

export class CreateTransferLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value)?.toUpperCase())
  declare referencia?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cantidad?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare valor?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare numeroCaja?: number;
}

export class CreateTransferDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  declare fecha?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoEnvia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoRecibe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare documentoOrigen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare observacion?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  declare fechaEmision?: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare interContable?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare idLote?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => toOptionalInteger(value))
  declare idDespacho?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  declare correccion?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare zona?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTransferLineDto)
  declare items?: CreateTransferLineDto[];
}

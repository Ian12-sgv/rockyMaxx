import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import {
  toOptionalInteger,
  toOptionalTrimmedString,
  toTrimmedString,
  toUpperTrimmedString,
} from "./transfer-dto.helpers";

export class CreateTransferLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare cantidad: string;

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

  @IsString()
  @MinLength(1)
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoEnvia: string;

  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoRecibe: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferLineDto)
  declare items: CreateTransferLineDto[];
}

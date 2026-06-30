import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "./compras-dto.helpers";

export class CompraItemDto {
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare codigoBarra: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(?:[.,]\d+)?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cantidad?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(?:[.,]\d+)?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare costoUnitario?: string;
}

export class CreateCompraDto {
  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare documento?: string;

  @IsString()
  @MaxLength(120)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare proveedor: string;

  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare tipoPago: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare observacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare destino?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(?:[.,]\d+)?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare totalMercancia?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(?:[.,]\d+)?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare tasaCambio?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInteger(value))
  declare idLote?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompraItemDto)
  declare items: CompraItemDto[];
}

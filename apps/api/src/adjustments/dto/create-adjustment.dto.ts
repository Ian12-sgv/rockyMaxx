import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsDate,
  IsIn,
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
} from "./adjustment-dto.helpers";

export class CreateAdjustmentLineDto {
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cantidad: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare costo?: string;
}

export class CreateAdjustmentDto {
  @IsIn(["positivo", "negativo", 1, -1, "1", "-1"])
  declare tipo: "positivo" | "negativo" | 1 | -1 | "1" | "-1";

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  declare fecha?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare observacion?: string;

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
  declare tipoAjuste?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdjustmentLineDto)
  declare items: CreateAdjustmentLineDto[];
}

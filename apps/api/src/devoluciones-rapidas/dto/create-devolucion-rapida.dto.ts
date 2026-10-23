import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

import { toOptionalTrimmedString, toUpperTrimmedString } from "../../transfers/dto/transfer-dto.helpers";

export const MAX_DEVOLUCION_RAPIDA_ITEMS = 500;

export class CreateDevolucionRapidaLineDto {
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value)?.toUpperCase())
  declare referencia?: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: "La cantidad debe ser un numero con hasta 2 decimales." })
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare cantidad: string;
}

export class CreateDevolucionRapidaDto {
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoTienda: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare observacion?: string;

  @IsArray()
  @ArrayMinSize(1, { message: "La devolucion rapida debe tener al menos un articulo." })
  @ArrayMaxSize(MAX_DEVOLUCION_RAPIDA_ITEMS, {
    message: `La devolucion rapida supera el maximo de ${MAX_DEVOLUCION_RAPIDA_ITEMS} articulos. Dividela en varias.`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateDevolucionRapidaLineDto)
  declare items: CreateDevolucionRapidaLineDto[];
}

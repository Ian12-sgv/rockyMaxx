import { Transform, Type } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

import {
  GASTO_CATEGORIAS,
  GASTO_MONEDAS,
  toOptionalTrimmedString,
  toTrimmedString,
  toUpperTrimmedString,
} from "../gasto-dto.helpers";

export class CreateGastoDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "La fecha del gasto debe tener formato AAAA-MM-DD." })
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare fecha: string;

  @IsIn(GASTO_CATEGORIAS, { message: "Categoria de gasto invalida." })
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare categoria: string;

  @IsString()
  @MinLength(1, { message: "Debes indicar la descripcion del gasto." })
  @MaxLength(300)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare descripcion: string;

  @IsIn(GASTO_MONEDAS, { message: "La moneda debe ser BS o USD." })
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare moneda: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: "El monto debe ser un numero con hasta 2 decimales." })
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare monto: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare referencia?: string;
}

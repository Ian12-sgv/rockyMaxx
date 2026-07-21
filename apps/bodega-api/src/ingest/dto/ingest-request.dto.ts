import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from "class-validator";

import { ENTIDADES_DESTINO, OPERACIONES_VALIDAS } from "../../shared/entidades";

export class IngestRegistroDto {
  @IsString()
  @IsNotEmpty()
  pkOrigen!: string;

  @IsIn(OPERACIONES_VALIDAS)
  operacion!: (typeof OPERACIONES_VALIDAS)[number];

  @IsObject()
  payload!: Record<string, unknown>;

  // Momento en que el extractor leyo la fila de origen (no el momento de envio).
  @IsISO8601()
  fechaExtraida!: string;
}

export class IngestTablaBatchDto {
  @IsIn(ENTIDADES_DESTINO)
  entidadDestino!: (typeof ENTIDADES_DESTINO)[number];

  @IsString()
  @IsNotEmpty()
  tablaOrigen!: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => IngestRegistroDto)
  registros!: IngestRegistroDto[];
}

export class IngestRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IngestTablaBatchDto)
  tablas!: IngestTablaBatchDto[];
}

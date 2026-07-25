import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

import { toOptionalTrimmedString, toUpperTrimmedStringArray } from "./price-change-dto.helpers";
import { PRICE_CHANGE_MODE_SELECTED_ITEMS, PRICE_CHANGE_MODES, PriceChangeMode } from "./price-change-mode";

export class CreatePriceChangeBatchDto {
  @IsIn(PRICE_CHANGE_MODES)
  declare mode: PriceChangeMode;

  // Tiendas destino (SYNC_NODES.NodeId). Nunca puede incluir Bodega Central/Bodega 002
  // (Decision 2) ni el propio nodo origen; validado en el servicio, donde se dispone del
  // contexto del nodo actual y de la consulta a SYNC_NODES.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedStringArray(value))
  declare destinationNodeIds: string[];

  // Solo obligatorio cuando mode=SELECTED_ITEMS. En FULL_INVENTORY se ignora aunque el
  // cliente lo envie: el backend siempre relee todo el Inventario de origen (ver Fase 4).
  @ValidateIf((dto: CreatePriceChangeBatchDto) => dto.mode === PRICE_CHANGE_MODE_SELECTED_ITEMS)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedStringArray(value))
  declare codigosBarra?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(250)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare observacion?: string;
}

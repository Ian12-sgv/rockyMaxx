import { Transform, Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsString, ValidateIf } from "class-validator";

import { toUpperTrimmedStringArray } from "./price-change-dto.helpers";
import { PRICE_CHANGE_MODE_SELECTED_ITEMS, PRICE_CHANGE_MODES, PriceChangeMode } from "./price-change-mode";

export class PreviewPriceChangeBatchDto {
  @IsIn(PRICE_CHANGE_MODES)
  declare mode: PriceChangeMode;

  // Solo obligatorio cuando mode=SELECTED_ITEMS. En FULL_INVENTORY se ignora aunque el
  // cliente lo envie: el backend siempre relee todo el Inventario de origen (ver Fase 4).
  @ValidateIf((dto: PreviewPriceChangeBatchDto) => dto.mode === PRICE_CHANGE_MODE_SELECTED_ITEMS)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedStringArray(value))
  declare codigosBarra?: string[];
}

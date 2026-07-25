import { Transform, Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

import { toUpperTrimmedStringArray } from "./price-change-dto.helpers";

export class RetryPriceChangeBatchDto {
  // Si se omite, reintenta TODAS las tiendas en FAILED_NETWORK. Si se especifica, cada
  // nodeId debe estar en FAILED_NETWORK o el servicio rechaza la solicitud completa.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedStringArray(value))
  declare destinationNodeIds?: string[];
}

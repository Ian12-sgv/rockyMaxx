import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString } from "../../transfers/dto/transfer-dto.helpers";

export class FindDevolucionesRapidasDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare buscar?: string;

  // 0 pendiente, 1 enviada a la tienda, 2 confirmada (la tienda la cargo).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  @Transform(({ value }) => toOptionalInteger(value))
  declare status?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  declare limit?: number;
}

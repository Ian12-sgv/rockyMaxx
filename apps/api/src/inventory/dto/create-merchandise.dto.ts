import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

import { toUpperTrimmedString } from "./merchandise-dto.helpers";
import { MerchandisePayloadDto } from "./merchandise-payload.dto";

export class CreateMerchandiseDto extends MerchandisePayloadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra: string;
}

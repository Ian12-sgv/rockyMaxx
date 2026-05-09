import { Transform, Type } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from "class-validator";

import { toOptionalTrimmedString, toUpperTrimmedString } from "./transfer-dto.helpers";

export class TransferDuplicateResolutionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare codigoBarra: string;

  @IsIn(["modify-existing", "create-new"])
  declare action: "modify-existing" | "create-new";

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value)?.toUpperCase())
  declare nuevoCodigoBarra?: string;
}

export class ApproveTransferDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferDuplicateResolutionDto)
  declare duplicateResolutions?: TransferDuplicateResolutionDto[];
}

import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from "class-validator";

import { toOptionalInteger, toOptionalTrimmedString, toUpperTrimmedString } from "./transfer-dto.helpers";

export class FindTransferSyncOutboxDto {
  @IsOptional()
  @IsString()
  @IsIn(["PENDING", "SENT", "ERROR"])
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

export class RegisterTransferSyncNodeDto {
  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare nodeId: string;

  @IsString()
  @MaxLength(15)
  @Type(() => String)
  @Transform(({ value }) => toUpperTrimmedString(value))
  declare sucursalCodigo: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value)?.toUpperCase())
  declare tipo?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(200)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare apiUrl?: string;
}

export class PushTransferSyncDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import { toOptionalInt, toTrimmedString, toUpperTrimmedString } from "./merchandise-dto.helpers";

export class FindMerchandiseDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => toTrimmedString(value))
  buscar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  @Transform(({ value }) => toTrimmedString(value))
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  fabricante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Transform(({ value }) => toUpperTrimmedString(value))
  talla?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  familia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  tipo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => toTrimmedString(value))
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => toOptionalInt(value))
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => toOptionalInt(value))
  limit?: number;
}

import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateCatalogEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  codigo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  nombre?: string;

  @IsOptional()
  @IsInt()
  status?: number;
}

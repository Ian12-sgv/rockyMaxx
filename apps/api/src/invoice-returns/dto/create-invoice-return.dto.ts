import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalTrimmedString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

export class InvoiceReturnLineDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  declare item: number;

  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare cantidad: string;
}

export class CreateInvoiceReturnDto {
  @IsString()
  @MaxLength(20)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare serie: string;

  @IsString()
  @MaxLength(40)
  @Type(() => String)
  @Transform(({ value }) => toTrimmedString(value))
  declare numeroFactura: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Type(() => String)
  @Transform(({ value }) => toOptionalTrimmedString(value))
  declare motivo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceReturnLineDto)
  declare items: InvoiceReturnLineDto[];
}

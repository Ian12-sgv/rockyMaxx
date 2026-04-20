import { Transform } from "class-transformer";
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  codUsuario!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  nombreUsuario?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  password!: string;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  grupos!: string[];
}
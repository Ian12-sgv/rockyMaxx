import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  usuario!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  password!: string;
}
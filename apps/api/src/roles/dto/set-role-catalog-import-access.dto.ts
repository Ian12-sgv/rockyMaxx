import { IsBoolean } from "class-validator";

export class SetRoleCatalogImportAccessDto {
  @IsBoolean()
  enabled!: boolean;
}

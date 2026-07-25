import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

import { toOptionalInteger } from "./price-change-dto.helpers";

// Mismo shape que PushTransferSyncDto (transfers/dto/transfer-sync.dto.ts:58-65); se
// reutiliza tanto para GET sync/pending (query) como POST sync/pull (body).
export class PriceChangeSyncPullDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Transform(({ value }) => toOptionalInteger(value))
  declare limit?: number;
}

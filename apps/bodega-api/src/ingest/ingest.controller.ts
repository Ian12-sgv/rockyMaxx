import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";

import { IngestAuthGuard } from "../auth/ingest-auth.guard";
import { IngestRequestDto } from "./dto/ingest-request.dto";
import { IngestService } from "./ingest.service";

@Controller("bodega/ingest")
@UseGuards(IngestAuthGuard)
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post(":codigoTienda")
  async ingest(@Param("codigoTienda") codigoTienda: string, @Body() dto: IngestRequestDto) {
    return this.ingestService.processIngest(codigoTienda, dto);
  }
}

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { IngestAuthGuard } from "../auth/ingest-auth.guard";
import { DiagnosticoService } from "./diagnostico.service";

@Controller("bodega/diagnostico")
@UseGuards(IngestAuthGuard)
export class DiagnosticoController {
  constructor(private readonly diagnosticoService: DiagnosticoService) {}

  @Post(":codigoTienda")
  async guardar(
    @Param("codigoTienda") codigoTienda: string,
    @Body() body: { generadoEn?: string; subsistemas?: Record<string, unknown> },
  ) {
    return this.diagnosticoService.guardar(codigoTienda, body);
  }

  @Get()
  async listar() {
    return this.diagnosticoService.listar();
  }

  @Get(":codigoTienda")
  async obtener(@Param("codigoTienda") codigoTienda: string) {
    return this.diagnosticoService.obtener(codigoTienda);
  }
}

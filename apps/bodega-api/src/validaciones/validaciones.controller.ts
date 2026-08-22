import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";

import { IngestAuthGuard } from "../auth/ingest-auth.guard";
import { ValidacionesService } from "./validaciones.service";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function requireFecha(fecha?: string) {
  if (!fecha || !FECHA_REGEX.test(fecha)) {
    throw new BadRequestException('Parametro "fecha" requerido en formato yyyy-MM-dd.');
  }
  return fecha;
}

function requireCodigoTienda(codigoTienda?: string) {
  const value = String(codigoTienda || "").trim().toUpperCase();
  if (!value) {
    throw new BadRequestException('Parametro "codigoTienda" requerido.');
  }
  return value;
}

@Controller("bodega/validaciones")
@UseGuards(IngestAuthGuard)
export class ValidacionesController {
  constructor(private readonly validacionesService: ValidacionesService) {}

  @Get("conteos")
  async conteos(@Query("codigoTienda") codigoTienda?: string) {
    return this.validacionesService.conteosPorTienda(codigoTienda?.trim().toUpperCase());
  }

  @Get("ventas-totales")
  async ventasTotales(@Query("codigoTienda") codigoTienda: string, @Query("fecha") fecha: string) {
    return this.validacionesService.ventasTotalesPorDia(requireCodigoTienda(codigoTienda), requireFecha(fecha));
  }

  @Get("pagos-totales")
  async pagosTotales(@Query("codigoTienda") codigoTienda: string, @Query("fecha") fecha: string) {
    return this.validacionesService.pagosTotalesPorDia(requireCodigoTienda(codigoTienda), requireFecha(fecha));
  }

  @Get("facturas-conteo")
  async facturasConteo(@Query("codigoTienda") codigoTienda: string, @Query("fecha") fecha: string) {
    const rows = await this.validacionesService.ventasTotalesPorDia(
      requireCodigoTienda(codigoTienda),
      requireFecha(fecha),
    );
    return rows.map((row) => ({ codigo_legacy: row.codigo_legacy, fecha: row.fecha, facturas: row.facturas }));
  }

  @Get("stock")
  async stock(@Query("codigoTienda") codigoTienda: string, @Query("codigoBarra") codigoBarra?: string) {
    return this.validacionesService.stockPorArticulo(requireCodigoTienda(codigoTienda), codigoBarra?.trim());
  }

  @Get("panel-resumen")
  async panelResumen() {
    return this.validacionesService.panelResumen();
  }

  @Get("errores-pendientes")
  async erroresPendientes(@Query("codigoTienda") codigoTienda?: string, @Query("limit") limit?: string) {
    const parsedLimit = Math.min(Math.max(parseInt(limit || "100", 10) || 100, 1), 500);
    return this.validacionesService.erroresPendientes(codigoTienda?.trim().toUpperCase(), parsedLimit);
  }
}

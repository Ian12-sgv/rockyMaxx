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

const MAX_RANGO_DIAS = 366;

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

// desde/hasta son opcionales -- sin ellos, panel-resumen se comporta como
// "Hoy" (compatibilidad hacia atras con el cliente viejo que no mandaba
// rango). Cuando SI vienen, deben ser fechas validas, desde <= hasta, y no
// abarcar mas de un anio (evita que alguien pida un rango gigante por error
// y tumbe la consulta).
function resolveRango(desde?: string, hasta?: string) {
  if (!desde && !hasta) {
    const hoy = hoyIso();
    return { desde: hoy, hasta: hoy };
  }

  if (!desde || !FECHA_REGEX.test(desde)) {
    throw new BadRequestException('Parametro "desde" invalido, formato esperado yyyy-MM-dd.');
  }
  if (!hasta || !FECHA_REGEX.test(hasta)) {
    throw new BadRequestException('Parametro "hasta" invalido, formato esperado yyyy-MM-dd.');
  }
  if (desde > hasta) {
    throw new BadRequestException('"desde" no puede ser posterior a "hasta".');
  }

  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;
  if (dias > MAX_RANGO_DIAS) {
    throw new BadRequestException(`El rango no puede superar ${MAX_RANGO_DIAS} dias.`);
  }

  return { desde, hasta };
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
  async panelResumen(@Query("desde") desde?: string, @Query("hasta") hasta?: string) {
    const rango = resolveRango(desde, hasta);
    return this.validacionesService.panelResumen(rango.desde, rango.hasta);
  }

  @Get("errores-pendientes")
  async erroresPendientes(@Query("codigoTienda") codigoTienda?: string, @Query("limit") limit?: string) {
    const parsedLimit = Math.min(Math.max(parseInt(limit || "100", 10) || 100, 1), 500);
    return this.validacionesService.erroresPendientes(codigoTienda?.trim().toUpperCase(), parsedLimit);
  }
}

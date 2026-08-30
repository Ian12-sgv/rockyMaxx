import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";

import { IngestAuthGuard } from "../auth/ingest-auth.guard";
import { BalanceService } from "./balance.service";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGO_DIAS = 366;

function hoyIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
}

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

@Controller("bodega/balance-movimientos")
@UseGuards(IngestAuthGuard)
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  async listar(
    @Query("desde") desde?: string,
    @Query("hasta") hasta?: string,
    @Query("codigoTienda") codigoTienda?: string,
  ) {
    const rango = resolveRango(desde, hasta);
    return this.balanceService.listarMovimientos(rango.desde, rango.hasta, codigoTienda?.trim().toUpperCase());
  }

  @Post()
  async crear(
    @Body()
    body: {
      tipo: "ingreso" | "egreso";
      esOperativo?: boolean;
      monto: number;
      descripcion: string;
      fecha: string;
      codigosTienda: string[];
      registradoPor?: string;
    },
  ) {
    if (!body?.fecha || !FECHA_REGEX.test(body.fecha)) {
      throw new BadRequestException('"fecha" invalida, formato esperado yyyy-MM-dd.');
    }
    return this.balanceService.crearMovimiento({
      tipo: body.tipo,
      esOperativo: Boolean(body.esOperativo),
      monto: Number(body.monto),
      descripcion: body.descripcion,
      fecha: body.fecha,
      codigosTienda: body.codigosTienda,
      registradoPor: body.registradoPor,
    });
  }

  @Patch(":id")
  async actualizar(
    @Param("id") id: string,
    @Body()
    body: {
      esOperativo?: boolean;
      monto: number;
      descripcion: string;
      fecha: string;
      codigosTienda: string[];
      registradoPor?: string;
    },
  ) {
    if (!body?.fecha || !FECHA_REGEX.test(body.fecha)) {
      throw new BadRequestException('"fecha" invalida, formato esperado yyyy-MM-dd.');
    }
    return this.balanceService.actualizarMovimiento(id, {
      esOperativo: Boolean(body.esOperativo),
      monto: Number(body.monto),
      descripcion: body.descripcion,
      fecha: body.fecha,
      codigosTienda: body.codigosTienda,
      registradoPor: body.registradoPor,
    });
  }

  @Delete(":id")
  async eliminar(@Param("id") id: string) {
    return this.balanceService.eliminarMovimiento(id);
  }
}

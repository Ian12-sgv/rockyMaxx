import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma-client";

import { AlcancePanel } from "../auth/panel-auth.service";
import { PrismaService } from "../prisma/prisma.service";

// Todas las agregaciones monetarias se hacen en SQL sobre columnas numeric
// castedas explicitamente desde payload_json, y se devuelven como string
// (Prisma serializa numeric/Decimal como string). No se usa Number()/parseFloat
// en ningun punto de este archivo.

// Lista blanca (no negra): solo cuentan en el panel las tiendas cuyo
// bodega-export corre DIRECTO desde su propia PC, con datos que se siguen
// actualizando de verdad. Las demas todavia llegan via la gemela de
// MirrorSync en el VPS, que se desactivo por decision del usuario -- sus
// numeros quedaron congelados en bodega_datos y mostrarlos confundiria con
// datos "en vivo" que ya no son. B002 tampoco entra: es una bodega/almacen,
// no una tienda de venta al publico.
// 006: 3.1.9 instalado 30/08/2026, confirmado con ETL_SYNC_RUNS que ya esta
// insertando registros frescos ese mismo dia (activacion automatica por
// nombre de base de datos, ver bodega-export.service.ts).
// 002/003/004/005: confirmado 31/08/2026 con ETL_SYNC_RUNS -- sync activo y
// reciente (mismo dia) desde database_name sin sufijo "_vps", con cientos/
// miles de runs acumulados desde el 22/08/2026 y error_count=0 (005 tuvo 5
// errores de idempotencia el 26/08, benignos y ya resueltos). Se verifico
// ademas que las gemelas de MirrorSync en el VPS para estas 4 tiendas
// tienen BODEGA_SYNC_ENABLED=false, asi que esta actividad es 100% de la
// PC real de cada tienda.
// Cuando otra tienda active bodega-export directo en su propia PC, sumar su
// codigo_legacy aqui (verificar primero en ETL_SYNC_RUNS que este
// insertando algo reciente, no solo que el registro exista).
const CODIGOS_TIENDA_ACTIVOS_PANEL = ["001", "002", "003", "004", "005", "006"];
const FILTRO_TIENDAS_PANEL = Prisma.sql`t."codigo_legacy" IN (${Prisma.join(CODIGOS_TIENDA_ACTIVOS_PANEL)})`;

// Grupo B = tiendas cuyo nombre contiene "rocky" (mismo criterio que
// getGrupoTienda() en public/app.js). Un usuario del grupo B solo recibe
// esas tiendas: el filtro va en el SQL, no en el frontend.
const FILTRO_GRUPO_B = Prisma.sql`t."nombre" ILIKE '%rocky%'`;

function filtroTiendasAlcance(alcance: AlcancePanel) {
  return alcance.grupo === "B" ? Prisma.sql`${FILTRO_TIENDAS_PANEL} AND ${FILTRO_GRUPO_B}` : FILTRO_TIENDAS_PANEL;
}

@Injectable()
export class ValidacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async conteosPorTienda(codigoTienda?: string) {
    const filtro = codigoTienda ? Prisma.sql`WHERE t."codigo_legacy" = ${codigoTienda}` : Prisma.empty;

    // COUNT(*) devuelve bigint; se castea a text porque el serializador JSON
    // de Express no sabe convertir BigInt (lanza TypeError en runtime).
    return this.prisma.$queryRaw<Array<{ codigo_legacy: string; entidad: string; total: string }>>(Prisma.sql`
      SELECT t."codigo_legacy", 'DIM_ARTICULOS_HIST' AS entidad, COUNT(*)::text AS total
      FROM "VW_DIM_ARTICULOS_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      UNION ALL
      SELECT t."codigo_legacy", 'DIM_CLIENTES_HIST', COUNT(*)::text
      FROM "VW_DIM_CLIENTES_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      UNION ALL
      SELECT t."codigo_legacy", 'HECH_INVENTARIO_HIST', COUNT(*)::text
      FROM "VW_HECH_INVENTARIO_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      UNION ALL
      SELECT t."codigo_legacy", 'HECH_VENTAS_HIST', COUNT(*)::text
      FROM "VW_HECH_VENTAS_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      UNION ALL
      SELECT t."codigo_legacy", 'HECH_VENTAS_DETALLE_HIST', COUNT(*)::text
      FROM "VW_HECH_VENTAS_DETALLE_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      UNION ALL
      SELECT t."codigo_legacy", 'HECH_PAGOS_HIST', COUNT(*)::text
      FROM "VW_HECH_PAGOS_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      UNION ALL
      SELECT t."codigo_legacy", 'HECH_CAJAS_HIST', COUNT(*)::text
      FROM "VW_HECH_CAJAS_ACTUAL" v JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id" ${filtro}
      GROUP BY t."codigo_legacy"
      ORDER BY 1, 2
    `);
  }

  async ventasTotalesPorDia(codigoTienda: string, fecha: string) {
    return this.prisma.$queryRaw<
      Array<{ codigo_legacy: string; fecha: string; facturas: string; total_pago: string; total_mercancia: string }>
    >(Prisma.sql`
      SELECT
        t."codigo_legacy",
        ${fecha}::date AS fecha,
        COUNT(*)::text AS facturas,
        COALESCE(SUM((v."payload_json" ->> 'TotalPago')::numeric), 0)::text AS total_pago,
        COALESCE(SUM((v."payload_json" ->> 'TotalMercancia')::numeric), 0)::text AS total_mercancia
      FROM "VW_HECH_VENTAS_ACTUAL" v
      JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
      WHERE t."codigo_legacy" = ${codigoTienda}
        AND (v."payload_json" ->> 'Fecha')::date = ${fecha}::date
      GROUP BY t."codigo_legacy"
    `);
  }

  async pagosTotalesPorDia(codigoTienda: string, fecha: string) {
    return this.prisma.$queryRaw<
      Array<{ codigo_legacy: string; fecha: string; pagos: string; total_monto: string }>
    >(Prisma.sql`
      SELECT
        t."codigo_legacy",
        ${fecha}::date AS fecha,
        COUNT(*)::text AS pagos,
        COALESCE(SUM((v."payload_json" ->> 'Monto')::numeric), 0)::text AS total_monto
      FROM "VW_HECH_PAGOS_ACTUAL" v
      JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
      WHERE t."codigo_legacy" = ${codigoTienda}
        AND (v."payload_json" ->> 'Fecha')::date = ${fecha}::date
      GROUP BY t."codigo_legacy"
    `);
  }

  async stockPorArticulo(codigoTienda: string, codigoBarra?: string) {
    const filtroArticulo = codigoBarra ? Prisma.sql`AND v."pk_origen" = ${codigoBarra}` : Prisma.empty;

    return this.prisma.$queryRaw<
      Array<{ codigo_legacy: string; codigo_barra: string; existencia: string; valido_desde: Date }>
    >(Prisma.sql`
      SELECT
        t."codigo_legacy",
        v."pk_origen" AS codigo_barra,
        (v."payload_json" ->> 'Existencia') AS existencia,
        v."valido_desde"
      FROM "VW_HECH_INVENTARIO_ACTUAL" v
      JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
      WHERE t."codigo_legacy" = ${codigoTienda} ${filtroArticulo}
      ORDER BY v."pk_origen" ASC
    `);
  }

  // Detalle de articulos del inventario actual de UNA tienda (el "Ver
  // articulos" de la seccion Inventario del panel). Paginado en el servidor
  // porque cada tienda tiene ~7000 articulos. valor_costo_usd usa la MISMA
  // formula que inventarioResumen() (Existencia * CostoPromedio), asi que la
  // suma de todas las paginas cuadra con el total de la tienda en el panel.
  // Busqueda opcional por codigo de barra, referencia o nombre.
  async inventarioDetalle(codigoTienda: string, busqueda: string, pagina: number, limite: number, alcance: AlcancePanel) {
    const texto = busqueda.trim();
    // Un usuario del grupo B que pida una tienda de otro grupo recibe 0 filas.
    const filtroAlcance = alcance.grupo === "B" ? Prisma.sql`AND ${FILTRO_GRUPO_B}` : Prisma.empty;
    const filtroBusqueda = texto
      ? Prisma.sql`AND (
          v."pk_origen" ILIKE ${`%${texto}%`}
          OR (v."payload_json" ->> 'Referencia') ILIKE ${`%${texto}%`}
          OR (v."payload_json" ->> 'Nombre') ILIKE ${`%${texto}%`}
        )`
      : Prisma.empty;
    const offset = (pagina - 1) * limite;

    const [filas, totales] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          codigo_barra: string;
          referencia: string | null;
          nombre: string | null;
          talla: string | null;
          existencia: string;
          costo_promedio_usd: string;
          valor_costo_usd: string;
        }>
      >(Prisma.sql`
        SELECT
          TRIM(v."pk_origen") AS codigo_barra,
          (v."payload_json" ->> 'Referencia') AS referencia,
          (v."payload_json" ->> 'Nombre') AS nombre,
          (v."payload_json" ->> 'Talla') AS talla,
          COALESCE((v."payload_json" ->> 'Existencia')::numeric, 0)::text AS existencia,
          COALESCE((v."payload_json" ->> 'CostoPromedio')::numeric, 0)::text AS costo_promedio_usd,
          COALESCE(
            (v."payload_json" ->> 'Existencia')::numeric * (v."payload_json" ->> 'CostoPromedio')::numeric,
            0
          )::text AS valor_costo_usd
        FROM "VW_HECH_INVENTARIO_ACTUAL" v
        JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
        WHERE t."codigo_legacy" = ${codigoTienda} ${filtroAlcance} ${filtroBusqueda}
        ORDER BY
          COALESCE(
            (v."payload_json" ->> 'Existencia')::numeric * (v."payload_json" ->> 'CostoPromedio')::numeric,
            0
          ) DESC,
          v."pk_origen" ASC
        LIMIT ${limite} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<Array<{ articulos: string; valor_costo_usd: string }>>(Prisma.sql`
        SELECT
          COUNT(*)::text AS articulos,
          COALESCE(
            SUM((v."payload_json" ->> 'Existencia')::numeric * (v."payload_json" ->> 'CostoPromedio')::numeric),
            0
          )::text AS valor_costo_usd
        FROM "VW_HECH_INVENTARIO_ACTUAL" v
        JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
        WHERE t."codigo_legacy" = ${codigoTienda} ${filtroAlcance} ${filtroBusqueda}
      `),
    ]);

    return {
      codigoTienda,
      busqueda: texto,
      pagina,
      limite,
      articulos: Number(totales[0]?.articulos ?? 0),
      valor_costo_usd: totales[0]?.valor_costo_usd ?? "0",
      filas,
    };
  }

  // Resumen para el panel principal (todas las tiendas juntas): ventas del
  // rango de fechas pedido, el mismo rango pero inmediatamente anterior (para
  // el "vs periodo anterior" del frontend) e inventario actual valorizado a
  // costo. Cada consulta de ventas trae una fila por tienda MAS una fila
  // "TOTAL".
  async panelResumen(desde: string, hasta: string, alcance: AlcancePanel) {
    const filtro = filtroTiendasAlcance(alcance);
    const tasaCambio = await this.tasaCambioActual(hasta);
    const tasaValor = tasaCambio?.tasa ? Number(tasaCambio.tasa) : 1;
    const { desde: desdeAnterior, hasta: hastaAnterior } = this.calcularRangoAnterior(desde, hasta);
    const diasSerie = Math.min(this.contarDias(desde, hasta), 60);

    const [ventas, ventasAnterior, inventario, serieDiaria, horarios] = await Promise.all([
      this.ventasResumenPorRango(desde, hasta, tasaValor, filtro),
      this.ventasResumenPorRango(desdeAnterior, hastaAnterior, tasaValor, filtro),
      this.inventarioResumen(filtro),
      this.ventasSerieDiaria(hasta, diasSerie, tasaValor, filtro),
      this.horariosPorTienda(desde, hasta, filtro),
    ]);

    return { ventas, ventasAnterior, inventario, serieDiaria, horarios, tasaCambio, rango: { desde, hasta } };
  }

  // Hora de "apertura" y "cierre" de cada tienda = primera y ultima factura
  // del dia. No se usa DIARIOCAJA a proposito: bodega-export solo manda cada
  // caja una vez (al crearse, abierta), asi que HoraCierre nunca llega a
  // bodega_datos (ninguna caja con cierre desde 30/08/2026), y HoraApertura
  // puede ser de la noche anterior cuando la caja se crea sola tras el Cierre
  // General.
  //
  // OJO con VENTAS.Fecha: facturacion.service.ts#buildSaleDateTime la arma
  // con la FECHA DE LA CAJA ABIERTA + la hora del reloj. Si una tienda sigue
  // vendiendo despues del Cierre General, esas facturas caen en la caja del
  // dia siguiente (abierta sola) y quedan con fecha de MANANA a la hora de
  // hoy (ej. vendida el 26 a las 6:04 pm -> Fecha 27 6:04 pm). Pasa casi a
  // diario en 002/003/005/006. Para la contabilidad es intencional (cuentan
  // para el dia siguiente), pero para "a que hora cerro" daba horas del
  // futuro. Se detecta porque la factura dice ser POSTERIOR a su primera
  // llegada a bodega_datos: si Fecha > primera recepcion + 1 h (margen para
  // relojes algo adelantados), se le restan los dias completos de mas
  // (CEIL, para cubrir tambien el caso en que la tienda envio recien a la
  // manana siguiente). Luego se agrupa por el dia REAL en hora de Venezuela.
  //
  // Por eso el dia de esta columna puede no coincidir 1:1 con el de las
  // facturas de la tabla (que siguen el criterio contable (Fecha)::date).
  // Si el rango abarca varios dias, se devuelve el dia MAS RECIENTE con
  // ventas de cada tienda (con su fecha, para que el frontend la muestre).
  // Fecha viene en UTC con sufijo Z (100% de las filas); el frontend la
  // muestra en hora de Venezuela.
  private async horariosPorTienda(desde: string, hasta: string, filtro: Prisma.Sql) {
    return this.prisma.$queryRaw<
      Array<{ codigo_legacy: string; fecha: string; primera_venta: Date; ultima_venta: Date }>
    >(Prisma.sql`
      -- Sin filtro por fecha a proposito: castear payload_json->>'Fecha' en
      -- todo el historial es mas lento (0.5-2 s medido) que agrupar todo
      -- (~0.1-0.3 s para 1 a 30 dias, medido el 27/09/2026).
      WITH primera_recepcion AS (
        SELECT h."dim_tienda_id", h."pk_origen", MIN(h."valido_desde") AS recibida
        FROM "HECH_VENTAS_HIST" h
        GROUP BY 1, 2
      ),
      ventas AS (
        SELECT
          t."codigo_legacy" AS codigo_legacy,
          (v."payload_json" ->> 'Fecha')::timestamptz AS fecha_factura,
          r.recibida
        FROM "VW_HECH_VENTAS_ACTUAL" v
        JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
        JOIN primera_recepcion r ON r."dim_tienda_id" = v."dim_tienda_id" AND r."pk_origen" = v."pk_origen"
        WHERE (v."payload_json" ->> 'Fecha')::date BETWEEN ${desde}::date - 1 AND ${hasta}::date + 2
          AND ${filtro}
      ),
      reales AS (
        SELECT
          codigo_legacy,
          CASE
            WHEN fecha_factura > recibida + INTERVAL '1 hour'
              THEN fecha_factura - CEIL(EXTRACT(EPOCH FROM (fecha_factura - recibida)) / 86400) * INTERVAL '1 day'
            ELSE fecha_factura
          END AS momento
        FROM ventas
      ),
      por_dia AS (
        SELECT
          codigo_legacy,
          (momento AT TIME ZONE 'America/Caracas')::date AS fecha,
          MIN(momento) AS primera_venta,
          MAX(momento) AS ultima_venta
        FROM reales
        GROUP BY 1, 2
      )
      SELECT DISTINCT ON (codigo_legacy)
        codigo_legacy,
        fecha::text AS fecha,
        primera_venta,
        ultima_venta
      FROM por_dia
      WHERE fecha BETWEEN ${desde}::date AND ${hasta}::date
      ORDER BY codigo_legacy, fecha DESC
    `);
  }

  // Rango inmediatamente anterior, de la misma duracion (en dias) que
  // [desde, hasta] -- ej. si el usuario elige "Ultimos 7 dias", el anterior
  // son los 7 dias antes de esos, no un valor fijo. Calculo en JS (no SQL)
  // para que sea facil de razonar/testear; las fechas viajan como texto
  // yyyy-MM-dd de un lado a otro, nunca como Date con zona horaria.
  private calcularRangoAnterior(desde: string, hasta: string) {
    const dias = this.contarDias(desde, hasta);
    const hastaAnteriorDate = this.sumarDias(desde, -1);
    const desdeAnteriorDate = this.sumarDias(hastaAnteriorDate, -(dias - 1));
    return { desde: desdeAnteriorDate, hasta: hastaAnteriorDate };
  }

  private contarDias(desde: string, hasta: string) {
    const msPorDia = 24 * 60 * 60 * 1000;
    return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / msPorDia) + 1;
  }

  private sumarDias(fecha: string, dias: number) {
    const date = new Date(`${fecha}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + dias);
    return date.toISOString().slice(0, 10);
  }

  // CTE reutilizado (costo vigente por articulo/tienda) + el JOIN contra el.
  // Para cada linea vendida (HECH_VENTAS_DETALLE_HIST), busca el costo
  // VIGENTE AHORA del mismo articulo en INVENTARIO -- no el costo que
  // quedaria congelado en la venta. Es el mismo criterio que ya usa el
  // reporte general de cierre de caja (cajas.service.ts,
  // resolveGeneralCloseInventoryUnitCost -> Inventario.CostoDolar), para que
  // "Costo de mercancia" de este panel cuadre con ese reporte.
  //
  // MATERIALIZED es obligatorio aqui: sin el, Postgres NO arma una sola tabla
  // hash de este CTE -- lo "desarma" y por cada linea vendida vuelve a
  // recorrer INVENTARIO entero filtrando por CodigoBarra (no tiene indice
  // funcional), un nested loop de ~N_lineas x N_articulos. Confirmado con
  // EXPLAIN ANALYZE: sin MATERIALIZED, 40+ segundos (y agotaba el pool de
  // conexiones de Prisma, P2024 "Timed out fetching a new connection"); con
  // MATERIALIZED, ~200ms.
  // CodigoBarra es la PK de INVENTARIO, asi que bodega-export la excluye del
  // payload_json (queda solo en pk_origen, ver payload.util.ts#buildPayload y
  // bodega-export.service.ts#buildInventarioBatches) -- "payload_json ->>
  // 'CodigoBarra'" en INVENTARIO da NULL siempre. El cruce va por pk_origen
  // (mismo patron que stockPorArticulo() en este archivo). TRIM en ambos
  // lados por espacios en blanco de CodigoBarra ya conocidos en este
  // proyecto (ver scripts/windows/migrate-local-barcodes-varchar30*).
  private static readonly COSTO_ACTUAL_CTE = Prisma.sql`
    inv_costo AS MATERIALIZED (
      SELECT
        i."dim_tienda_id" AS dim_tienda_id,
        TRIM(i."pk_origen") AS codigo_barra,
        (i."payload_json" ->> 'CostoDolar')::numeric AS costo_dolar
      FROM "VW_HECH_INVENTARIO_ACTUAL" i
    )
  `;

  private static readonly COSTO_ACTUAL_JOIN = Prisma.sql`
    LEFT JOIN inv_costo inv ON inv.dim_tienda_id = d."dim_tienda_id" AND inv.codigo_barra = TRIM(d."payload_json" ->> 'CodigoBarra')
  `;

  // Cantidad neta vendida (descontando lo devuelto) por costo VIGENTE del
  // articulo, en dolares -- igual formula que
  // cajas.service.ts#calculateGeneralCloseInventoryCost.
  //
  // ROUND(..., 2) por LINEA (no en costo_dolar antes de multiplicar -- el
  // reporte real solo redondea el PRODUCTO cantidad*costoUnitario, ver
  // cajas.service.ts:777 costoTotal = costoUnitario.mul(cantidad).toDecimalPlaces(2))
  // es necesario para cuadrar centavo a centavo con ese reporte: sumar
  // primero con precision completa y redondear una sola vez al final da un
  // total ligeramente distinto (diferencia de centavos) que redondear cada
  // linea y sumar los redondeados -- confirmado contra datos reales
  // (diferencia de USD 0.08 sobre 319 lineas antes de este cambio).
  private static readonly COSTO_ACTUAL_EXPR = Prisma.sql`
    ROUND(
      GREATEST(
        (d."payload_json" ->> 'Cantidad')::numeric - COALESCE((d."payload_json" ->> 'CantidadDevuelta')::numeric, 0),
        0
      ) * COALESCE(inv.costo_dolar, 0),
      2
    )
  `;

  // Serie diaria (ultimos N dias contados hacia atras desde "hasta") de la
  // misma fuente/conversion que ventasResumenPorRango -- alimenta las
  // mini-graficas de tendencia. "hasta" es el fin del rango que el usuario
  // eligio (no necesariamente hoy), asi que el sparkline siempre termina en
  // el mismo punto que el rango seleccionado.
  private async ventasSerieDiaria(hasta: string, dias: number, tasaValor: number, filtro: Prisma.Sql) {
    return this.prisma.$queryRaw<
      Array<{ fecha: string; facturas: string; total_pago: string; total_costo_bs: string; ganancia: string }>
    >(Prisma.sql`
      WITH ${ValidacionesService.COSTO_ACTUAL_CTE},
      header AS (
        SELECT
          (v."payload_json" ->> 'Fecha')::date AS fecha,
          COUNT(*) AS facturas,
          SUM((v."payload_json" ->> 'TotalPago')::numeric) AS total_pago
        FROM "VW_HECH_VENTAS_ACTUAL" v
        JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
        WHERE (v."payload_json" ->> 'Fecha')::date BETWEEN ${hasta}::date - (${dias - 1} * INTERVAL '1 day') AND ${hasta}::date
          AND ${filtro}
        GROUP BY 1
      ),
      costo AS (
        SELECT
          (d."payload_json" ->> 'Hora')::date AS fecha,
          SUM(${ValidacionesService.COSTO_ACTUAL_EXPR}) AS total_costo_usd
        FROM "VW_HECH_VENTAS_DETALLE_ACTUAL" d
        JOIN "DIM_TIENDAS" t ON t."id" = d."dim_tienda_id"
        ${ValidacionesService.COSTO_ACTUAL_JOIN}
        WHERE (d."payload_json" ->> 'Hora')::date BETWEEN ${hasta}::date - (${dias - 1} * INTERVAL '1 day') AND ${hasta}::date
          AND ${filtro}
        GROUP BY 1
      )
      SELECT
        COALESCE(h.fecha, c.fecha)::text AS fecha,
        COALESCE(h.facturas, 0)::text AS facturas,
        COALESCE(h.total_pago, 0)::text AS total_pago,
        (COALESCE(c.total_costo_usd, 0) * ${tasaValor}::numeric)::text AS total_costo_bs,
        (COALESCE(h.total_pago, 0) - COALESCE(c.total_costo_usd, 0) * ${tasaValor}::numeric)::text AS ganancia
      FROM header h
      FULL OUTER JOIN costo c ON c.fecha = h.fecha
      ORDER BY 1
    `);
  }

  // TasaCambio no se sincroniza a bodega_datos como tabla propia (ver nota en
  // inventarioResumen), pero cada venta ya trae la tasa vigente al momento en
  // que se facturo -- la venta mas reciente CON FECHA <= hasta es entonces la
  // mejor aproximacion disponible de "la tasa vigente para el rango elegido"
  // sin tener que montar un pipeline de sincronizacion nuevo solo para esto.
  // Antes esto ignoraba el rango y siempre traia la tasa MAS reciente de
  // todas (aunque el usuario estuviera viendo "Mes pasado" o "Ayer") -- a
  // pedido del usuario, ahora la tasa mostrada corresponde a la fecha que
  // eligio, no siempre a la de hoy.
  private async tasaCambioActual(hasta: string) {
    const rows = await this.prisma.$queryRaw<Array<{ tasa: string; fecha: string }>>(Prisma.sql`
      SELECT
        (v."payload_json" ->> 'TasaCambio')::numeric::text AS tasa,
        (v."payload_json" ->> 'Fecha') AS fecha
      FROM "VW_HECH_VENTAS_ACTUAL" v
      JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
      WHERE (v."payload_json" ->> 'TasaCambio') IS NOT NULL
        AND (v."payload_json" ->> 'Fecha')::date <= ${hasta}::date
        AND ${FILTRO_TIENDAS_PANEL}
      ORDER BY (v."payload_json" ->> 'Fecha')::timestamp DESC
      LIMIT 1
    `);
    return rows[0] || null;
  }

  // "Vendido"/"facturas" salen de la cabecera de la venta (VENTAS.TotalPago),
  // igual que el reporte general de cierre de caja -- deberian coincidir
  // exacto con ese reporte.
  // "Costo de mercancia" YA NO usa VENTAS.TotalCosto (el costo que quedo
  // congelado al momento de facturar): ahora usa el costo VIGENTE AHORA del
  // articulo (Inventario.CostoDolar) por la cantidad neta vendida -- el mismo
  // criterio que ya usa el reporte general de cierre de caja
  // (cajas.service.ts#calculateGeneralCloseInventoryCost), a pedido del
  // usuario, para que ambos reportes cuadren. Esto significa que "Costo" aqui
  // puede moverse retroactivamente si el costo de un articulo cambia despues
  // de la venta -- es intencional, no un bug.
  private async ventasResumenPorRango(desde: string, hasta: string, tasaValor: number, filtro: Prisma.Sql) {
    return this.prisma.$queryRaw<
      Array<{
        codigo_legacy: string;
        nombre: string | null;
        facturas: string;
        total_pago: string;
        total_costo_bs: string;
        ganancia: string;
      }>
    >(Prisma.sql`
      WITH ${ValidacionesService.COSTO_ACTUAL_CTE},
      header AS (
        SELECT
          t."codigo_legacy" AS codigo_legacy,
          t."nombre" AS nombre,
          COUNT(*) AS facturas,
          SUM((v."payload_json" ->> 'TotalPago')::numeric) AS total_pago
        FROM "VW_HECH_VENTAS_ACTUAL" v
        JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
        WHERE (v."payload_json" ->> 'Fecha')::date BETWEEN ${desde}::date AND ${hasta}::date
          AND ${filtro}
        GROUP BY 1, 2
      ),
      costo AS (
        SELECT
          t."codigo_legacy" AS codigo_legacy,
          t."nombre" AS nombre,
          SUM(${ValidacionesService.COSTO_ACTUAL_EXPR}) AS total_costo_usd
        FROM "VW_HECH_VENTAS_DETALLE_ACTUAL" d
        JOIN "DIM_TIENDAS" t ON t."id" = d."dim_tienda_id"
        ${ValidacionesService.COSTO_ACTUAL_JOIN}
        WHERE (d."payload_json" ->> 'Hora')::date BETWEEN ${desde}::date AND ${hasta}::date
          AND ${filtro}
        GROUP BY 1, 2
      ),
      combinado AS (
        SELECT
          COALESCE(h.codigo_legacy, c.codigo_legacy) AS codigo_legacy,
          COALESCE(h.nombre, c.nombre) AS nombre,
          COALESCE(h.facturas, 0) AS facturas,
          COALESCE(h.total_pago, 0) AS total_pago,
          COALESCE(c.total_costo_usd, 0) * ${tasaValor}::numeric AS total_costo_bs
        FROM header h
        FULL OUTER JOIN costo c ON c.codigo_legacy = h.codigo_legacy
      )
      SELECT codigo_legacy, nombre, facturas::text, total_pago::text, total_costo_bs::text, (total_pago - total_costo_bs)::text AS ganancia
      FROM (
        SELECT codigo_legacy, nombre, facturas, total_pago, total_costo_bs FROM combinado
        UNION ALL
        SELECT 'TOTAL', NULL, SUM(facturas), SUM(total_pago), SUM(total_costo_bs) FROM combinado
      ) resumen
      ORDER BY 1
    `);
  }

  // CostoPromedio en INVENTARIO esta en dolares, igual que TotalCosto en
  // VENTAS -- pero a diferencia de una venta, una fila de inventario no
  // lleva una tasa de cambio propia (es un costo "vivo", no un hecho
  // historico con su tasa del momento). Convertir a bolivares aqui
  // requeriria traer la tabla TASA_CAMBIO a bodega_datos (no se sincroniza
  // hoy), asi que el valor se reporta en dolares, explicito en el nombre del
  // campo.
  private async inventarioResumen(filtro: Prisma.Sql) {
    return this.prisma.$queryRaw<
      Array<{ codigo_legacy: string; nombre: string | null; articulos: string; unidades: string; valor_costo_usd: string }>
    >(Prisma.sql`
      SELECT
        COALESCE(t."codigo_legacy", 'TOTAL') AS codigo_legacy,
        CASE WHEN GROUPING(t."codigo_legacy") = 1 THEN NULL ELSE MAX(t."nombre") END AS nombre,
        COUNT(*)::text AS articulos,
        COALESCE(SUM((v."payload_json" ->> 'Existencia')::numeric), 0)::text AS unidades,
        COALESCE(
          SUM((v."payload_json" ->> 'Existencia')::numeric * (v."payload_json" ->> 'CostoPromedio')::numeric),
          0
        )::text AS valor_costo_usd
      FROM "VW_HECH_INVENTARIO_ACTUAL" v
      JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
      WHERE ${filtro}
      GROUP BY GROUPING SETS ((t."codigo_legacy"), ())
      ORDER BY 1
    `);
  }

  async erroresPendientes(codigoTienda?: string, limit = 100) {
    const filtro = codigoTienda ? Prisma.sql`WHERE t."codigo_legacy" = ${codigoTienda}` : Prisma.empty;

    return this.prisma.$queryRaw<
      Array<{
        id: string;
        codigo_legacy: string;
        tabla_origen: string;
        pk_origen: string | null;
        error_message: string;
        created_at: Date;
      }>
    >(Prisma.sql`
      SELECT e."id", t."codigo_legacy", e."tabla_origen", e."pk_origen", e."error_message", e."created_at"
      FROM "ETL_SYNC_ERRORS" e
      JOIN "DIM_TIENDAS" t ON t."id" = e."dim_tienda_id"
      ${filtro}
      ORDER BY e."created_at" DESC
      LIMIT ${limit}
    `);
  }
}

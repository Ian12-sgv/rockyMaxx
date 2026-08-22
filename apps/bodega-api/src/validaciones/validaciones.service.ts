import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma-client";

import { PrismaService } from "../prisma/prisma.service";

// Todas las agregaciones monetarias se hacen en SQL sobre columnas numeric
// castedas explicitamente desde payload_json, y se devuelven como string
// (Prisma serializa numeric/Decimal como string). No se usa Number()/parseFloat
// en ningun punto de este archivo.

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

  // Resumen para el panel principal (todas las tiendas juntas): ventas de
  // hoy, ventas del mes en curso, e inventario actual valorizado a costo.
  // Cada consulta trae una fila por tienda MAS una fila "TOTAL" agregada via
  // GROUPING SETS ((codigo_legacy), ()) -- una sola pasada, sin sumar en el
  // cliente.
  async panelResumen() {
    const [ventasHoy, ventasMes, inventario] = await Promise.all([
      this.ventasResumenPorPeriodo(Prisma.sql`(v."payload_json" ->> 'Fecha')::date = CURRENT_DATE`),
      this.ventasResumenPorPeriodo(
        Prisma.sql`date_trunc('month', (v."payload_json" ->> 'Fecha')::date) = date_trunc('month', CURRENT_DATE)`,
      ),
      this.inventarioResumen(),
    ]);

    return { ventasHoy, ventasMes, inventario };
  }

  // TotalCosto en VENTAS esta en dolares (igual que TotalDolares); TotalPago/
  // TotalMercancia estan en bolivares. TasaCambio es la tasa de ESA venta
  // puntual (cambia con el tiempo), asi que el costo se convierte a
  // bolivares POR FILA antes de sumar -- sumar TasaCambio y multiplicar
  // despues mezclaria tasas de fechas distintas.
  private async ventasResumenPorPeriodo(filtroFecha: Prisma.Sql) {
    return this.prisma.$queryRaw<
      Array<{
        codigo_legacy: string;
        facturas: string;
        total_pago: string;
        total_costo_bs: string;
        ganancia: string;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(codigo_legacy, 'TOTAL') AS codigo_legacy,
        COUNT(*)::text AS facturas,
        COALESCE(SUM(total_pago), 0)::text AS total_pago,
        COALESCE(SUM(total_costo_bs), 0)::text AS total_costo_bs,
        COALESCE(SUM(total_pago) - SUM(total_costo_bs), 0)::text AS ganancia
      FROM (
        SELECT
          t."codigo_legacy" AS codigo_legacy,
          (v."payload_json" ->> 'TotalPago')::numeric AS total_pago,
          (v."payload_json" ->> 'TotalCosto')::numeric * COALESCE((v."payload_json" ->> 'TasaCambio')::numeric, 1)
            AS total_costo_bs
        FROM "VW_HECH_VENTAS_ACTUAL" v
        JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
        WHERE ${filtroFecha}
      ) filas
      GROUP BY GROUPING SETS ((codigo_legacy), ())
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
  private async inventarioResumen() {
    return this.prisma.$queryRaw<
      Array<{ codigo_legacy: string; articulos: string; unidades: string; valor_costo_usd: string }>
    >(Prisma.sql`
      SELECT
        COALESCE(t."codigo_legacy", 'TOTAL') AS codigo_legacy,
        COUNT(*)::text AS articulos,
        COALESCE(SUM((v."payload_json" ->> 'Existencia')::numeric), 0)::text AS unidades,
        COALESCE(
          SUM((v."payload_json" ->> 'Existencia')::numeric * (v."payload_json" ->> 'CostoPromedio')::numeric),
          0
        )::text AS valor_costo_usd
      FROM "VW_HECH_INVENTARIO_ACTUAL" v
      JOIN "DIM_TIENDAS" t ON t."id" = v."dim_tienda_id"
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

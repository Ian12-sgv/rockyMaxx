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

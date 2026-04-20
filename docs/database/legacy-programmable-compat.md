# Legacy Programmable Compatibility Status

## Deliverable

- Base mirror: `database/postgres/legacy_mirror.sql`
- Initial compatibility layer: `database/postgres/legacy_programmable_compat.sql`
- Remaining routines layer: `database/postgres/legacy_programmable_remaining.sql`

Load order:

1. `legacy_mirror.sql`
2. `legacy_programmable_compat.sql`
3. `legacy_programmable_remaining.sql`

## Validation

- Validated against PostgreSQL `18.1` in a temporary database.
- Validation command loaded the three SQL files inside a reversible transaction and finished without fatal SQL errors.
- The temporary validation database was dropped after the check.

## Coverage

- Original programmable objects in the export: `68`
- Original programmable objects now represented in PostgreSQL: `68`
- Original programmable objects still pending: `0`

## What Was Added In The Remaining Pass

### Additional inferred support objects

The remaining pass added the support objects that were still required by the coupon, promotion and backup routines:

- `REGLASCONVENIOS`
- `TABLA_PARAMETROS`
- `CUPONES`
- `CODIGOSCONVENIOS`
- `TRANSACCIONESCUPONES`
- `grupo_cupones`
- `RESPALDOS_PENDIENTES`
- extra columns in `REFERENCIAS_MAYORISTAS`

These are still inferred objects, not original SQL Server DDL, and are marked in the SQL with comments where appropriate.

### Remaining routines now represented

The following previously pending SQL Server procedures now have PostgreSQL routine equivalents in `legacy_programmable_remaining.sql`:

- `Cupones_SelectorDeImpresion`
- `PROCESAR_MOVITRAN`
- `PromocionesYOfertas_Descuento_MAYORISTAS`
- `PromocionesYOfertas_DescuentoCatalogo`
- `PromocionesYOfertas_DescuentoEnSiMismo`
- `PromocionesYOfertas_DescuentoGeneralEnSiMismo`
- `PromocionesYOfertas_DescuentoGeneralMismoGrupo`
- `PromocionesYOfertas_DescuentosDistintoGrupo`
- `PromocionesYOfertas_DescuentosMismoGrupo`
- `PromocionesYOfertas_DevolverRemanente`
- `PromocionesYOfertas_InsertarRestosFacturacion`
- `PromocionesYOfertas_SelectorDeReglas`
- `PromocionesYOfertas_SelectorDeReglas_Convenios`
- `RespaldoBD`
- `Selector_Reglas`

## Exactness Boundary

All exported programmable objects are now represented in PostgreSQL, but not every object can be literal at engine level because PostgreSQL is not SQL Server.

Important engine-level adaptations:

- `RespaldoBD`: represented as a PostgreSQL compatibility routine that records the backup request in `dbo."RESPALDOS_PENDIENTES"`. PostgreSQL does not support `BACKUP DATABASE` from SQL the same way SQL Server does; the actual backup still has to be executed with `pg_dump` or `pg_basebackup` outside SQL.
- `PROCESAR_MOVITRAN`: represented as a best-effort XML validation/import routine for PostgreSQL. It validates remissions and performs catalog/inventory upserts for purchase or transfer imports, but it is not a literal byte-for-byte translation of SQL Server XML + document-processing semantics.
- `PromocionesYOfertas_*`: represented with PostgreSQL temp-table and dynamic-table compatibility logic. The routine family compiles and loads correctly, but it should still be verified with real sales cases because the legacy promotion engine was heavily procedural and SQL Server-specific.

## Practical Result

The previous blocker is now closed at package level:

- Structural mirror validated in PostgreSQL.
- Original views, functions, procedures and inferred support objects all load successfully as a PostgreSQL compatibility package.
- The remaining work from here is functional testing with real data and then wiring these routines into the NestJS + Prisma migration flow.

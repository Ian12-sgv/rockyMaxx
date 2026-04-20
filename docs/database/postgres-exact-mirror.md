# PostgreSQL Exact Mirror Status

## What This Artifact Does

- Generates a PostgreSQL DDL mirror from the SQL Server metadata CSV exports.
- Preserves exact table names, column names, nullability, primary keys, unique constraints and foreign keys.
- Recreates SQL Server identity columns as PostgreSQL sequences with column defaults.
- Replays SQL Server default values when they are portable.

## Generated Deliverable

- SQL mirror file: `database/postgres/legacy_mirror.sql`

## Source Counts Reflected

- Tables in `dbo`: `59`
- Primary key constraints: `59`
- Unique constraints: `4`
- Foreign keys: `74`
- Identity columns: `5`
- Columns with SQL Server collation metadata: `187`
- Defaults converted automatically: `179`
- Defaults requiring manual rewrite: `0`

## Engine-Level Differences That Prevent a Literal 100 Percent Clone

- SQL Server collation `Modern_Spanish_CI_AS` does not exist as a byte-for-byte equivalent in PostgreSQL. The SQL file keeps the inventory but not a synthetic replacement collation.
- SQL Server clustered indexes do not have a direct PostgreSQL equivalent. Primary keys and unique constraints are recreated, but heap storage layout is different.
- SQL Server programmable objects are written in T-SQL and cannot be copied verbatim into PostgreSQL.

## Programmable Object Inventory Still Pending Rewrite

- Stored procedures: `50`
- Views: `13`
- Scalar functions: `3`
- Table-valued functions: `2`

## Exactness Boundary

- Table structure parity: high and metadata-driven.
- Referential parity: exact according to the exported foreign key metadata.
- Default parity: exact for the exported default shapes present in this database export.
- Procedural parity: not yet migrated.

## Prisma Boundary

- Prisma is suitable for the application data model.
- Prisma is not the right source of truth for an engine-level exact mirror because it does not cover SQL Server collations, SQL module bodies or storage-level index semantics.

-- =============================================================================
-- Migracion: ampliar CodigoBarra legacy de varchar(15) a varchar(30)
--
-- Contexto: dbo."INVENTARIO"."CodigoBarra" / "Referencia" / "CodigoBarraAnt" ya
-- estan en varchar(30) en todas las bases productivas (VPS y local), pero varias
-- tablas de movimiento/legado heredadas del esquema SQL Server original siguen
-- en varchar(15) y pueden truncar o rechazar codigos de barra mas largos.
--
-- Alcance (solo columnas "CodigoBarra"):
--   CODIGOS_RECARGOS, FISICOLOGICO, IMOVDEVTRANSFERENCIAS, IMOVTRANSFERENCIAS,
--   MOVAJUSTES, MOVDEVBORRADOR, MOVDEVCOMPRAS, MOVDEVTRANSFERENCIAS,
--   MOVDEVVENTAS, MOVTOMAFISICA1, MOVTOMAFISICA2, MOVVENTAS, SALDODIARIO,
--   TRANSFER_CORRECTION_ITEMS.
--
-- Fuera de alcance a proposito (investigar aparte, no tocar aqui):
--   dbo."GRUPO_REGLAS"."CodigoBarra" (varchar(18))
--   dbo.grupo_cupones."Referencia" (varchar(10))
--
-- Idempotencia:
--   - Cada columna se verifica contra information_schema antes de alterarla.
--   - Si la tabla/columna no existe en esta base, se omite con RAISE NOTICE
--     (no falla).
--   - Si ya esta en varchar(30) o mas ancha, se omite con RAISE NOTICE.
--   - Las vistas se recrean con CREATE OR REPLACE VIEW usando la misma
--     definicion versionada en database/postgres/legacy_programmable_compat.sql,
--     asi que ejecutar el script varias veces no cambia su resultado.
--
-- Vistas dependientes:
--   PostgreSQL bloquea ALTER TABLE ... ALTER COLUMN TYPE cuando una vista (o
--   regla) depende de esa columna, incluso si el cambio es solo ampliar el
--   largo. Se verifico contra la base local (rocky_maxx) via
--   information_schema.view_column_usage que las unicas vistas afectadas son:
--     VW_AJUSTESNEGATIVOS       (depende de MOVAJUSTES.CodigoBarra)
--     VW_AJUSTESPOSITIVOS       (depende de MOVAJUSTES.CodigoBarra)
--     VW_DEVCOMPRASXPROVEEDOR   (depende de MOVDEVCOMPRAS.CodigoBarra)
--     VW_DEVTRANSFERENCIAS      (depende de MOVDEVTRANSFERENCIAS.CodigoBarra)
--   Por eso se dropean antes de alterar y se recrean despues, sin cambiar su
--   definicion.
--
-- Uso:
--   psql -h <host> -U <usuario> -d <base> -v ON_ERROR_STOP=1 \
--     -f database/postgres/20260719_widen_legacy_codigobarra_varchar30.sql
--
-- Restricciones respetadas: no restaura bases, no borra datos, no recrea
-- tablas con datos, no toca GRUPO_REGLAS ni grupo_cupones, no cambia logica
-- de negocio. Aplicar primero en local, revisar con la auditoria de
-- information_schema, y solo despues en cada nodo del VPS con supervision.
-- =============================================================================

BEGIN;

DROP VIEW IF EXISTS dbo."VW_AJUSTESNEGATIVOS";
DROP VIEW IF EXISTS dbo."VW_AJUSTESPOSITIVOS";
DROP VIEW IF EXISTS dbo."VW_DEVCOMPRASXPROVEEDOR";
DROP VIEW IF EXISTS dbo."VW_DEVTRANSFERENCIAS";

DO $$
DECLARE
  targets text[][] := ARRAY[
    ['CODIGOS_RECARGOS', 'CodigoBarra'],
    ['FISICOLOGICO', 'CodigoBarra'],
    ['IMOVDEVTRANSFERENCIAS', 'CodigoBarra'],
    ['IMOVTRANSFERENCIAS', 'CodigoBarra'],
    ['MOVAJUSTES', 'CodigoBarra'],
    ['MOVDEVBORRADOR', 'CodigoBarra'],
    ['MOVDEVCOMPRAS', 'CodigoBarra'],
    ['MOVDEVTRANSFERENCIAS', 'CodigoBarra'],
    ['MOVDEVVENTAS', 'CodigoBarra'],
    ['MOVTOMAFISICA1', 'CodigoBarra'],
    ['MOVTOMAFISICA2', 'CodigoBarra'],
    ['MOVVENTAS', 'CodigoBarra'],
    ['SALDODIARIO', 'CodigoBarra'],
    ['TRANSFER_CORRECTION_ITEMS', 'CodigoBarra']
  ];
  t text[];
  current_length integer;
BEGIN
  FOREACH t SLICE 1 IN ARRAY targets LOOP
    SELECT character_maximum_length INTO current_length
    FROM information_schema.columns
    WHERE table_schema = 'dbo' AND table_name = t[1] AND column_name = t[2];

    IF current_length IS NULL THEN
      RAISE NOTICE 'Omitido: dbo.%.% no existe en esta base', t[1], t[2];
    ELSIF current_length >= 30 THEN
      RAISE NOTICE 'Omitido: dbo.%.% ya es varchar(%)', t[1], t[2], current_length;
    ELSE
      EXECUTE format('ALTER TABLE dbo.%I ALTER COLUMN %I TYPE varchar(30)', t[1], t[2]);
      RAISE NOTICE 'Ampliado: dbo.%.% de varchar(%) a varchar(30)', t[1], t[2], current_length;
    END IF;
  END LOOP;
END $$;

-- Recreacion de vistas dependientes (definicion identica a
-- database/postgres/legacy_programmable_compat.sql, sin cambios logicos).

CREATE OR REPLACE VIEW dbo."VW_AJUSTESNEGATIVOS" AS
WITH "AJUSTESNEGATIVOS_CTE" AS (
  SELECT
    a."Fecha",
    m."CodigoBarra",
    sum(m."Cantidad") AS "UND_AJUSTESNEGATIVOS",
    sum(m."Cantidad" * m."Costo") AS "COSTO_AJUSTESNEGATIVOS"
  FROM dbo."AJUSTES" a
  INNER JOIN dbo."MOVAJUSTES" m ON a."Numero" = m."Numero"
  WHERE a."Status" <> 0 AND a."Signo" = -1
  GROUP BY a."Fecha", m."CodigoBarra"
)
SELECT "Fecha", "CodigoBarra", "UND_AJUSTESNEGATIVOS", "COSTO_AJUSTESNEGATIVOS"
FROM "AJUSTESNEGATIVOS_CTE";

CREATE OR REPLACE VIEW dbo."VW_AJUSTESPOSITIVOS" AS
WITH "AJUSTESPOSITIVOS_CTE" AS (
  SELECT
    a."Fecha",
    m."CodigoBarra",
    sum(m."Cantidad") AS "UND_AJUSTESPOSITIVOS",
    sum(m."Cantidad" * m."Costo") AS "COSTO_AJUSTEPOSITIVO"
  FROM dbo."AJUSTES" a
  INNER JOIN dbo."MOVAJUSTES" m ON a."Numero" = m."Numero"
  WHERE a."Status" <> 0 AND a."Signo" = 1
  GROUP BY a."Fecha", m."CodigoBarra"
)
SELECT "Fecha", "CodigoBarra", "UND_AJUSTESPOSITIVOS", "COSTO_AJUSTEPOSITIVO"
FROM "AJUSTESPOSITIVOS_CTE";

CREATE OR REPLACE VIEW dbo."VW_DEVCOMPRASXPROVEEDOR" AS
WITH "DEVCOMPRAS_CTE" AS (
  SELECT
    d."Fecha",
    m."CodigoBarra",
    sum(m."Cantidad") AS "UND_DEVCOMPRADAS",
    sum(m."Cantidad" * m."Precio") AS "COSTO_DEVCOMPRA"
  FROM dbo."DEVCOMPRAS" d
  INNER JOIN dbo."MOVDEVCOMPRAS" m ON d."Numero" = m."Numero"
  WHERE d."Status" <> 0
  GROUP BY d."Fecha", d."Proveedor", m."CodigoBarra"
)
SELECT "Fecha", "CodigoBarra", "UND_DEVCOMPRADAS", "COSTO_DEVCOMPRA"
FROM "DEVCOMPRAS_CTE";

CREATE OR REPLACE VIEW dbo."VW_DEVTRANSFERENCIAS" AS
WITH "DEVTRANSFERENCIAS_CTE" AS (
  SELECT
    d."Fecha",
    d."CodigoRecibe",
    m."CodigoBarra",
    sum(m."Cantidad") AS "UND_DEVTRANSFERIDAS",
    sum(m."Cantidad" * m."Valor") AS "COSTO_DEVTRANSFERENCIA"
  FROM dbo."DEVTRANSFERENCIAS" d
  INNER JOIN dbo."MOVDEVTRANSFERENCIAS" m ON d."Numero" = m."Numero"
  WHERE d."Status" <> 0
  GROUP BY d."Fecha", d."CodigoRecibe", m."CodigoBarra"
)
SELECT "Fecha", "CodigoRecibe", "CodigoBarra", "UND_DEVTRANSFERIDAS", "COSTO_DEVTRANSFERENCIA"
FROM "DEVTRANSFERENCIAS_CTE";

COMMIT;

[CmdletBinding()]
param(
  [string]$DatabaseHost = "localhost",
  [int]$DatabasePort = 5432,
  [string]$DatabaseUser = "postgres"
)

$ErrorActionPreference = "Stop"

function Find-Psql {
  $command = Get-Command "psql.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @()
  $postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
  if (Test-Path -LiteralPath $postgresRoot) {
    $candidates += Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "bin\psql.exe" } |
      Where-Object { Test-Path -LiteralPath $_ }
  }

  $selected = $candidates | Sort-Object -Descending | Select-Object -First 1
  if (-not $selected) {
    throw "No se encontro psql.exe. Instale las herramientas de PostgreSQL o agregue su carpeta bin al PATH."
  }
  return $selected
}

function Invoke-PsqlScalar {
  param(
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  $result = @(
    & $script:PsqlPath -X --host=$DatabaseHost --port=$DatabasePort `
      --username=$DatabaseUser --dbname=$Database --no-align --tuples-only `
      --set=ON_ERROR_STOP=1 --command=$Sql
  )
  if ($LASTEXITCODE -ne 0) {
    throw "psql fallo al consultar '$Database' (codigo $LASTEXITCODE)."
  }
  return ($result | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
}

$migrationSql = @'
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
  target text[];
  current_length integer;
BEGIN
  FOREACH target SLICE 1 IN ARRAY targets LOOP
    SELECT character_maximum_length INTO current_length
    FROM information_schema.columns
    WHERE table_schema = 'dbo'
      AND table_name = target[1]
      AND column_name = target[2];

    IF current_length IS NULL THEN
      RAISE NOTICE 'Omitido: dbo.%.% no existe', target[1], target[2];
    ELSIF current_length >= 30 THEN
      RAISE NOTICE 'Omitido: dbo.%.% ya es varchar(%)', target[1], target[2], current_length;
    ELSE
      EXECUTE format('ALTER TABLE dbo.%I ALTER COLUMN %I TYPE varchar(30)', target[1], target[2]);
      RAISE NOTICE 'Ampliado: dbo.%.% de varchar(%) a varchar(30)', target[1], target[2], current_length;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE VIEW dbo."VW_AJUSTESNEGATIVOS" AS
WITH "AJUSTESNEGATIVOS_CTE" AS (
  SELECT a."Fecha", m."CodigoBarra",
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
  SELECT a."Fecha", m."CodigoBarra",
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
  SELECT d."Fecha", m."CodigoBarra",
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
  SELECT d."Fecha", d."CodigoRecibe", m."CodigoBarra",
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
'@

$auditSql = @'
WITH targets(table_name, column_name) AS (
  VALUES
    ('CODIGOS_RECARGOS', 'CodigoBarra'),
    ('FISICOLOGICO', 'CodigoBarra'),
    ('IMOVDEVTRANSFERENCIAS', 'CodigoBarra'),
    ('IMOVTRANSFERENCIAS', 'CodigoBarra'),
    ('MOVAJUSTES', 'CodigoBarra'),
    ('MOVDEVBORRADOR', 'CodigoBarra'),
    ('MOVDEVCOMPRAS', 'CodigoBarra'),
    ('MOVDEVTRANSFERENCIAS', 'CodigoBarra'),
    ('MOVDEVVENTAS', 'CodigoBarra'),
    ('MOVTOMAFISICA1', 'CodigoBarra'),
    ('MOVTOMAFISICA2', 'CodigoBarra'),
    ('MOVVENTAS', 'CodigoBarra'),
    ('SALDODIARIO', 'CodigoBarra'),
    ('TRANSFER_CORRECTION_ITEMS', 'CodigoBarra')
)
SELECT t.table_name || '.' || t.column_name || '=' ||
       COALESCE(c.character_maximum_length::text, 'NO_EXISTE')
FROM targets t
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'dbo'
 AND c.table_name = t.table_name
 AND c.column_name = t.column_name
ORDER BY t.table_name;
'@

$script:PsqlPath = Find-Psql
$securePassword = Read-Host "Clave de PostgreSQL" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$previousPgPassword = $env:PGPASSWORD
$hadPgPassword = Test-Path Env:PGPASSWORD

try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)

  $databaseSql = "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres' ORDER BY datname;"
  $databases = @(Invoke-PsqlScalar -Database "postgres" -Sql $databaseSql)
  if ($databases.Count -eq 0) {
    throw "No se encontraron bases de datos de usuario."
  }

  Write-Host "Bases de datos detectadas:" -ForegroundColor Cyan
  for ($index = 0; $index -lt $databases.Count; $index++) {
    Write-Host ("  {0}. {1}" -f ($index + 1), $databases[$index])
  }

  $selectionText = Read-Host "Seleccione el numero de la base"
  $selection = 0
  if (-not [int]::TryParse($selectionText, [ref]$selection) -or
      $selection -lt 1 -or $selection -gt $databases.Count) {
    throw "Seleccion no valida."
  }

  $selectedDatabase = $databases[$selection - 1]
  $rockyCheckSql = "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'dbo' AND table_name = 'INVENTARIO') THEN 'OK' ELSE 'NO' END;"
  $rockyCheck = Invoke-PsqlScalar -Database $selectedDatabase -Sql $rockyCheckSql
  if ($rockyCheck -ne "OK") {
    throw "La base '$selectedDatabase' no contiene dbo.INVENTARIO."
  }

  Write-Host "Base seleccionada: $selectedDatabase" -ForegroundColor Yellow
  Write-Host "ATENCION: esta ejecucion no creara respaldo." -ForegroundColor Red
  $confirmation = Read-Host "Cierre Rocky Maxx y escriba MIGRAR para continuar"
  if ($confirmation -cne "MIGRAR") {
    throw "Operacion cancelada."
  }

  $migrationSql | & $script:PsqlPath -X --host=$DatabaseHost --port=$DatabasePort `
    --username=$DatabaseUser --dbname=$selectedDatabase --set=ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) {
    throw "La migracion fallo (codigo $LASTEXITCODE). PostgreSQL revirtio la transaccion."
  }

  Write-Host "Auditoria:" -ForegroundColor Cyan
  Invoke-PsqlScalar -Database $selectedDatabase -Sql $auditSql |
    ForEach-Object { Write-Host "  $_" }

  Write-Host "MIGRACION COMPLETADA" -ForegroundColor Green
  Write-Host "Las columnas existentes de las 14 tablas objetivo quedaron en varchar(30)."
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($hadPgPassword) {
    $env:PGPASSWORD = $previousPgPassword
  } else {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

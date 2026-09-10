[CmdletBinding()]
param(
  [string]$DatabaseHost = "localhost",
  [int]$DatabasePort = 5432,
  [string]$DatabaseUser = "postgres",
  [string]$MigrationScriptPath = "",
  [string]$BackupDirectory = ""
)

$ErrorActionPreference = "Stop"

function Find-PostgresTool {
  param([Parameter(Mandatory = $true)][string]$ToolName)

  $command = Get-Command "$ToolName.exe" -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $roots = @(
    (Join-Path $env:ProgramFiles "PostgreSQL")
  )

  if (${env:ProgramFiles(x86)}) {
    $roots += Join-Path ${env:ProgramFiles(x86)} "PostgreSQL"
  }

  $candidates = foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root) {
      Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "bin\$ToolName.exe" } |
        Where-Object { Test-Path -LiteralPath $_ }
    }
  }

  $selected = $candidates | Sort-Object -Descending | Select-Object -First 1
  if (-not $selected) {
    throw "No se encontro $ToolName.exe. Instale las herramientas de PostgreSQL o agregue su carpeta bin al PATH."
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
    throw "psql fallo al consultar la base '$Database' (codigo $LASTEXITCODE)."
  }

  return ($result | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
}

if (-not $MigrationScriptPath) {
  $repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $MigrationScriptPath = Join-Path $repositoryRoot "database\postgres\20260719_widen_legacy_codigobarra_varchar30.sql"
}

if (-not $BackupDirectory) {
  $BackupDirectory = Join-Path $PSScriptRoot "database-backups\pre-codigobarra-varchar30"
}

$MigrationScriptPath = [System.IO.Path]::GetFullPath($MigrationScriptPath)
$BackupDirectory = [System.IO.Path]::GetFullPath($BackupDirectory)

if (-not (Test-Path -LiteralPath $MigrationScriptPath -PathType Leaf)) {
  throw "No se encontro el script SQL: $MigrationScriptPath"
}

$script:PsqlPath = Find-PostgresTool -ToolName "psql"
$pgDumpPath = Find-PostgresTool -ToolName "pg_dump"

Write-Host "Migracion local CodigoBarra varchar(15) -> varchar(30)" -ForegroundColor Cyan
Write-Host "Servidor: ${DatabaseHost}:$DatabasePort"
Write-Host "Usuario: $DatabaseUser"
Write-Host "SQL: $MigrationScriptPath"
Write-Host ""

$securePassword = Read-Host "Clave de PostgreSQL" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null
$previousPgPassword = $env:PGPASSWORD
$hadPgPassword = Test-Path Env:PGPASSWORD

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $env:PGPASSWORD = $plainPassword

  $databaseSql = @'
SELECT datname
FROM pg_database
WHERE datallowconn
  AND NOT datistemplate
  AND datname <> 'postgres'
ORDER BY datname;
'@

  $databases = @(Invoke-PsqlScalar -Database "postgres" -Sql $databaseSql)
  if ($databases.Count -eq 0) {
    throw "No se encontraron bases de datos de usuario en el servidor indicado."
  }

  Write-Host ""
  Write-Host "Bases de datos detectadas:" -ForegroundColor Cyan
  for ($index = 0; $index -lt $databases.Count; $index++) {
    Write-Host ("  {0}. {1}" -f ($index + 1), $databases[$index])
  }

  $selectionText = Read-Host "Seleccione el numero de la base"
  $selection = 0
  if (-not [int]::TryParse($selectionText, [ref]$selection)) {
    throw "La seleccion debe ser un numero."
  }
  if ($selection -lt 1 -or $selection -gt $databases.Count) {
    throw "La seleccion esta fuera del rango mostrado."
  }

  $selectedDatabase = $databases[$selection - 1]
  $rockyCheckSql = @'
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'dbo' AND table_name = 'INVENTARIO'
) THEN 'ROCKY_OK' ELSE 'NO_ES_ROCKY' END;
'@
  $rockyCheck = Invoke-PsqlScalar -Database $selectedDatabase -Sql $rockyCheckSql
  if ($rockyCheck -ne "ROCKY_OK") {
    throw "La base '$selectedDatabase' no contiene dbo.INVENTARIO. No se ejecutara la migracion."
  }

  Write-Host ""
  Write-Host "Base seleccionada: $selectedDatabase" -ForegroundColor Yellow
  Write-Host "Cierre Rocky Maxx y detenga el Servicio Local antes de continuar." -ForegroundColor Yellow
  $confirmation = Read-Host "Escriba MIGRAR para crear el respaldo y aplicar el cambio"
  if ($confirmation -cne "MIGRAR") {
    throw "Operacion cancelada. No se hizo ningun cambio."
  }

  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeDatabaseName = $selectedDatabase -replace '[^A-Za-z0-9._-]', '_'
  $backupPath = Join-Path $BackupDirectory "$safeDatabaseName-pre-codigobarra30-$timestamp.custom.dump"

  Write-Host ""
  Write-Host "Creando respaldo..." -ForegroundColor Cyan
  & $pgDumpPath --host=$DatabaseHost --port=$DatabasePort --username=$DatabaseUser `
    --dbname=$selectedDatabase --format=custom --file=$backupPath

  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump fallo (codigo $LASTEXITCODE). No se ejecuto la migracion."
  }
  if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    throw "pg_dump no creo el archivo esperado. No se ejecuto la migracion."
  }

  $backupFile = Get-Item -LiteralPath $backupPath
  if ($backupFile.Length -le 0) {
    throw "El respaldo quedo vacio. No se ejecuto la migracion."
  }

  Write-Host ("Respaldo OK: {0} ({1:N0} bytes)" -f $backupPath, $backupFile.Length) -ForegroundColor Green
  Write-Host "Aplicando migracion..." -ForegroundColor Cyan

  & $script:PsqlPath -X --host=$DatabaseHost --port=$DatabasePort `
    --username=$DatabaseUser --dbname=$selectedDatabase --set=ON_ERROR_STOP=1 `
    --file=$MigrationScriptPath

  if ($LASTEXITCODE -ne 0) {
    throw "La migracion fallo (codigo $LASTEXITCODE). PostgreSQL revirtio la transaccion. El respaldo esta en: $backupPath"
  }

  $auditDetailSql = @'
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

  Write-Host ""
  Write-Host "Auditoria de columnas objetivo:" -ForegroundColor Cyan
  Invoke-PsqlScalar -Database $selectedDatabase -Sql $auditDetailSql |
    ForEach-Object { Write-Host "  $_" }

  $auditSummarySql = @'
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
), target_state AS (
  SELECT
    count(*) FILTER (WHERE c.table_name IS NULL) AS missing_count,
    count(*) FILTER (WHERE c.table_name IS NOT NULL AND c.character_maximum_length < 30) AS short_count
  FROM targets t
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'dbo'
   AND c.table_name = t.table_name
   AND c.column_name = t.column_name
), view_state AS (
  SELECT count(*) AS view_count
  FROM information_schema.views
  WHERE table_schema = 'dbo'
    AND table_name IN (
      'VW_AJUSTESNEGATIVOS',
      'VW_AJUSTESPOSITIVOS',
      'VW_DEVCOMPRASXPROVEEDOR',
      'VW_DEVTRANSFERENCIAS'
    )
), inventory_state AS (
  SELECT count(*) AS inventory_count
  FROM information_schema.columns
  WHERE table_schema = 'dbo'
    AND table_name = 'INVENTARIO'
    AND column_name IN ('CodigoBarra', 'CodigoBarraAnt', 'Referencia')
    AND character_maximum_length >= 30
)
SELECT target_state.short_count || '|' || target_state.missing_count || '|' ||
       view_state.view_count || '|' || inventory_state.inventory_count
FROM target_state, view_state, inventory_state;
'@

  $auditSummary = Invoke-PsqlScalar -Database $selectedDatabase -Sql $auditSummarySql
  $auditParts = $auditSummary -split '\|'
  if ($auditParts.Count -ne 4) {
    throw "No se pudo interpretar el resultado de la auditoria: $auditSummary"
  }

  $shortCount = [int]$auditParts[0]
  $missingCount = [int]$auditParts[1]
  $viewCount = [int]$auditParts[2]
  $inventoryCount = [int]$auditParts[3]

  if ($shortCount -ne 0 -or $viewCount -ne 4 -or $inventoryCount -ne 3) {
    throw "Auditoria no conforme: columnas menores a 30=$shortCount, vistas=$viewCount/4, INVENTARIO=$inventoryCount/3. Conserve el respaldo y no inicie Rocky Maxx."
  }

  Write-Host ""
  Write-Host "MIGRACION COMPLETADA" -ForegroundColor Green
  Write-Host "Base: $selectedDatabase"
  Write-Host "Columnas existentes menores a 30: $shortCount"
  Write-Host "Columnas objetivo no existentes: $missingCount"
  Write-Host "Vistas verificadas: $viewCount/4"
  Write-Host "INVENTARIO CodigoBarra/Anterior/Referencia: $inventoryCount/3 en varchar(30) o mayor"
  Write-Host "Respaldo: $backupPath"
  Write-Host "Ya puede iniciar el Servicio Local y realizar la prueba funcional."
}
finally {
  if ($null -ne $plainPassword) {
    $plainPassword = $null
  }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($hadPgPassword) {
    $env:PGPASSWORD = $previousPgPassword
  }
  else {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

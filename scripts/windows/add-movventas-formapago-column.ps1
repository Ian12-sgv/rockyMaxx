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

# Aditivo e idempotente: no borra ni modifica datos existentes. Es la misma
# instruccion que PrismaService aplica solo al arrancar el backend.
$migrationSql = @'
ALTER TABLE IF EXISTS dbo."MOVVENTAS"
ADD COLUMN IF NOT EXISTS "FormaPago" INTEGER;
'@

$auditSql = @'
SELECT 'MOVVENTAS.FormaPago=' ||
       COALESCE(
         (SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'dbo' AND table_name = 'MOVVENTAS' AND column_name = 'FormaPago'),
         'NO_EXISTE'
       );
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
  Write-Host ("  {0}. TODAS las anteriores" -f ($databases.Count + 1))

  $selectionText = Read-Host "Seleccione el numero de la base (o el numero de 'TODAS')"
  $selection = 0
  if (-not [int]::TryParse($selectionText, [ref]$selection) -or
      $selection -lt 1 -or $selection -gt ($databases.Count + 1)) {
    throw "Seleccion no valida."
  }

  $targetDatabases = if ($selection -eq ($databases.Count + 1)) { $databases } else { @($databases[$selection - 1]) }

  foreach ($targetDatabase in $targetDatabases) {
    $rockyCheckSql = "SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'dbo' AND table_name = 'MOVVENTAS') THEN 'OK' ELSE 'NO' END;"
    $rockyCheck = Invoke-PsqlScalar -Database $targetDatabase -Sql $rockyCheckSql
    if ($rockyCheck -ne "OK") {
      Write-Host "Omitido: '$targetDatabase' no contiene dbo.MOVVENTAS." -ForegroundColor DarkYellow
      continue
    }

    Write-Host "Aplicando en '$targetDatabase'..." -ForegroundColor Yellow
    $migrationSql | & $script:PsqlPath -X --host=$DatabaseHost --port=$DatabasePort `
      --username=$DatabaseUser --dbname=$targetDatabase --set=ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) {
      throw "La migracion fallo en '$targetDatabase' (codigo $LASTEXITCODE)."
    }

    $audit = Invoke-PsqlScalar -Database $targetDatabase -Sql $auditSql
    Write-Host ("  {0} -> {1}" -f $targetDatabase, $audit) -ForegroundColor Green
  }

  Write-Host "LISTO." -ForegroundColor Green
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

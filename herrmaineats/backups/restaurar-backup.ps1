param(
  [string]$BackupFile,
  [string]$Host = "localhost",
  [int]$Port = 5432,
  [string]$User = "postgres",
  [string]$TargetDatabase = "rocky_maxx_restored",
  [switch]$DropAndRecreate
)

$ErrorActionPreference = "Stop"

$backupDir = $PSScriptRoot

if (-not $BackupFile) {
  $latest = Get-ChildItem -Path $backupDir -Filter "*.custom.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $latest) {
    throw "No se encontro ningun archivo .custom.dump en $backupDir"
  }

  $BackupFile = $latest.FullName
}
elseif (-not [System.IO.Path]::IsPathRooted($BackupFile)) {
  $BackupFile = Join-Path $backupDir $BackupFile
}

if (-not (Test-Path $BackupFile)) {
  throw "No existe el backup solicitado: $BackupFile"
}

if (-not $env:PGPASSWORD) {
  Write-Warning "PGPASSWORD no esta definido. PostgreSQL puede pedir credenciales interactivamente."
}

if ($DropAndRecreate) {
  & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h $Host -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS `"$TargetDatabase`";"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h $Host -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE `"$TargetDatabase`";"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h $Host -p $Port -U $User -d $TargetDatabase --clean --if-exists --no-owner --no-privileges $BackupFile
exit $LASTEXITCODE

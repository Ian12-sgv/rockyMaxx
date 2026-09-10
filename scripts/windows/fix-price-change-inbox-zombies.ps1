# Corrige el bug de PRICE_CHANGE_SYNC_INBOX que se queda marcado 'RECEIVED' para siempre
# aunque el Cambio de Precio ya se haya aplicado (bug de codigo ya corregido en price-changes.service.ts,
# esto solo destraba lo que ya quedo atascado ANTES de reinstalar la version con el fix).
# 100% aditivo: solo corrige un campo "Status" en filas que, segun su propia
# PRICE_CHANGE_BATCH_STORE, YA estan resueltas. No toca Inventario, no borra nada.
# Si la base no tiene el modulo de Cambio de Precio activado, no hace nada (mensaje informativo).
# Seguro para reintentar cuantas veces quieras.
#
# Uso: copiar este archivo a la PC destino y correrlo con:
#   powershell -ExecutionPolicy Bypass -File fix-price-change-inbox-zombies.ps1

$env:PGPASSWORD = "123456"
$pgUser = "postgres"
$pgHost = "localhost"
$pgPort = "5432"

Write-Host "Detectando bases rocky_* en esta PC..." -ForegroundColor Cyan
$rawList = & psql -h $pgHost -p $pgPort -U $pgUser -d postgres -lqt
if ($LASTEXITCODE -ne 0) {
    Write-Host "No se pudo conectar a Postgres en ${pgHost}:${pgPort} con el usuario $pgUser. Revisa que Postgres este corriendo y las credenciales sean correctas (editar las variables pgUser/PGPASSWORD arriba si esta PC usa otras)." -ForegroundColor Red
    exit 1
}

$databases = $rawList |
    ForEach-Object { ($_ -split '\|')[0].Trim() } |
    Where-Object { $_ -like "rocky_*" }

if (-not $databases) {
    Write-Host "No se encontro ninguna base rocky_* en esta PC." -ForegroundColor Yellow
    exit 0
}

Write-Host "Bases encontradas:" -ForegroundColor Cyan
$databases | ForEach-Object { Write-Host "  - $_" }
Write-Host ""

$sql = @'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'dbo' AND table_name = 'PRICE_CHANGE_SYNC_INBOX'
  ) THEN
    UPDATE dbo."PRICE_CHANGE_SYNC_INBOX" i
    SET "Status" = s."Status"
    FROM dbo."PRICE_CHANGE_BATCH_STORE" s
    WHERE i."BatchId" = s."BatchId"
      AND i."EventType" = 'PRICE_CHANGE_BATCH'
      AND i."Status" = 'RECEIVED'
      AND s."DestinationNodeId" = i."DestinationNodeId"
      AND s."Status" IN ('APPLIED','PARTIAL_APPLIED','FAILED_APPLY');
    RAISE NOTICE 'Backfill aplicado (o nada que corregir).';
  ELSE
    RAISE NOTICE 'Esta base no tiene el modulo de Cambio de Precio activado -- nada que hacer.';
  END IF;
END $$;
'@

# Se escribe a un archivo temporal en vez de -c $sql, y sin BOM -- mismas dos trampas de
# PowerShell 5.1 -> psql.exe ya resueltas en apply-formapago-columns.ps1 (comillas dobles
# perdidas al pasar por argumentos, y BOM que psql interpreta como texto literal).
$sqlFile = Join-Path $env:TEMP "fix-price-change-inbox-zombies.sql"
[System.IO.File]::WriteAllText($sqlFile, $sql, (New-Object System.Text.UTF8Encoding($false)))

$fallidas = @()
foreach ($db in $databases) {
    Write-Host "=== $db ===" -ForegroundColor Cyan
    psql -h $pgHost -p $pgPort -U $pgUser -d $db -v ON_ERROR_STOP=1 -f $sqlFile
    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK: $db" -ForegroundColor Green
    } else {
        Write-Host "FALLO: $db (exit $LASTEXITCODE)" -ForegroundColor Red
        $fallidas += $db
    }
}

Remove-Item $sqlFile -ErrorAction SilentlyContinue

Write-Host ""
if ($fallidas.Count -eq 0) {
    Write-Host "Listo." -ForegroundColor Green
} else {
    Write-Host "Terminado con errores en: $($fallidas -join ', ')" -ForegroundColor Red
}

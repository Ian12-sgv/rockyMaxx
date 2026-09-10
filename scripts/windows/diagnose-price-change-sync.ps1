# Diagnostico de "Cambio de Precio" (apps/api/src/price-changes/) para correr EN LA PC de
# una tienda/bodega fisica. Responde: donde se atasco (si es que se atasco) y si el
# problema es de base de datos local o de otra capa (red/config/auth hacia el VPS).
#
# 100% de solo lectura: no actualiza, no borra, no aplica nada. Seguro para correr las
# veces que haga falta.
#
# Uso: copiar este archivo a la PC destino y correrlo con:
#   powershell -ExecutionPolicy Bypass -File diagnose-price-change-sync.ps1

$env:PGPASSWORD = "123456"
$pgUser = "postgres"
$pgHost = "localhost"
$pgPort = "5432"

Write-Host "Detectando bases rocky_tienda_* / rocky_bodega_* LOCALES (sin sufijo _vps) en esta PC..." -ForegroundColor Cyan
$rawList = & psql -h $pgHost -p $pgPort -U $pgUser -d postgres -lqt
if ($LASTEXITCODE -ne 0) {
    Write-Host "No se pudo conectar a Postgres en ${pgHost}:${pgPort} con el usuario $pgUser." -ForegroundColor Red
    Write-Host "Esto SI es un problema de base de datos: Postgres no esta arriba o las credenciales no sirven en esta PC." -ForegroundColor Red
    Write-Host "(Si el sistema de facturacion/caja funciona con normalidad hoy en esta PC, en cambio, Postgres esta vivo y el problema no es de conexion general -- revisar mas abajo.)" -ForegroundColor Yellow
    exit 1
}

$databases = $rawList |
    ForEach-Object { ($_ -split '\|')[0].Trim() } |
    Where-Object { $_ -match '^rocky_(tienda|bodega)_\d+$' }

if (-not $databases) {
    Write-Host "No se encontro ninguna base rocky_tienda_*/rocky_bodega_* local en esta PC." -ForegroundColor Yellow
    exit 0
}

$sql = @'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'dbo' AND table_name = 'PRICE_CHANGE_SYNC_INBOX'
  ) THEN
    RAISE NOTICE 'SIN_MODULO: esta base nunca corrio el modulo de Cambio de Precio (tabla PRICE_CHANGE_SYNC_INBOX no existe). Si el resto del sistema funciona, el servicio simplemente no ha reiniciado con una version que lo incluya, o el modulo fallo al crear su esquema al arrancar -- revisar el log del servicio en el arranque.';
  END IF;
END $$;

\echo '--- PRICE_CHANGE_SYNC_INBOX: conteo por Status (vista local del rol VPS/REMOTO propio, si aplica) ---'
SELECT "Status", "EventType", count(*), min("ReceivedAt") AS mas_viejo, max("ReceivedAt") AS mas_reciente
FROM dbo."PRICE_CHANGE_SYNC_INBOX"
GROUP BY "Status", "EventType"
ORDER BY 1, 2;

\echo '--- PRICE_CHANGE_BATCH_STORE: conteo por Status (batches donde ESTA base es tienda destino) ---'
SELECT "Status", count(*), min("CreatedAt") AS mas_viejo, max("UpdatedAt") AS ultima_actualizacion
FROM dbo."PRICE_CHANGE_BATCH_STORE"
GROUP BY "Status"
ORDER BY 1;

\echo '--- Batches NO terminales mas viejos (si hay filas aqui con UpdatedAt de hace rato, esta atascado en la aplicacion local) ---'
SELECT "BatchId", "DestinationNodeId", "Status", "Attempts", "LastError", "CreatedAt", "UpdatedAt"
FROM dbo."PRICE_CHANGE_BATCH_STORE"
WHERE "Status" NOT IN ('APPLIED', 'PARTIAL_APPLIED', 'FAILED_APPLY')
ORDER BY "CreatedAt" ASC
LIMIT 10;

\echo '--- Resultados por articulo en ERROR (si hay filas aqui, SI es un error real de datos/aplicacion, con mensaje) ---'
SELECT "BatchId", "DestinationNodeId", "CodigoBarra", "Status", "ErrorMessage", "AppliedAt"
FROM dbo."PRICE_CHANGE_BATCH_ITEM_RESULT"
WHERE "Status" NOT IN ('APPLIED', 'PENDING')
ORDER BY "AppliedAt" DESC NULLS LAST
LIMIT 20;
'@

$sqlFile = Join-Path $env:TEMP "diagnose-price-change-sync.sql"
[System.IO.File]::WriteAllText($sqlFile, $sql, (New-Object System.Text.UTF8Encoding($false)))

foreach ($db in $databases) {
    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host " $db" -ForegroundColor Cyan
    Write-Host "======================================================" -ForegroundColor Cyan
    psql -h $pgHost -p $pgPort -U $pgUser -d $db -f $sqlFile
}

Remove-Item $sqlFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Como leer esto:" -ForegroundColor Green
Write-Host "  - Si PRICE_CHANGE_SYNC_INBOX esta VACIA o muy atrasada frente a lo que ya se sabe que" -ForegroundColor Green
Write-Host "    esta pendiente en el VPS para esta tienda -> el paso que trae los pendientes por HTTP" -ForegroundColor Green
Write-Host "    (fetch-remote) no esta corriendo o no esta llegando. NO es un problema de base de" -ForegroundColor Green
Write-Host "    datos: revisar en el .env local PRICE_CHANGE_SYNC_AUTO_RETRY_ENABLED, MIRROR_SYNC_REMOTE_API_URL" -ForegroundColor Green
Write-Host "    y TRANSFER_SYNC_USERNAME/PASSWORD, y la conectividad de esta PC hacia el VPS." -ForegroundColor Green
Write-Host "  - Si SI hay filas en PRICE_CHANGE_BATCH_STORE pero se quedan en RECEIVED_BY_STORE o" -ForegroundColor Green
Write-Host "    APPLYING sin avanzar (UpdatedAt viejo) o con LastError -> ahi si es un problema de" -ForegroundColor Green
Write-Host "    base de datos/aplicacion local; revisar LastError arriba y los resultados en ERROR." -ForegroundColor Green

# Fuerza un intento inmediato de sincronizacion hacia bodega de datos (VPS) en la PC
# donde corre el Servicio Local, sin esperar hasta 1 minuto al proximo ciclo automatico.
#
# Util para casos como: "se arreglo la red de la tienda / se reinicio el Servicio Local
# y no se quiere esperar a ver si ya vuelve a sincronizar solo".
#
# Solo funciona llamado DESDE la misma PC (el backend rechaza la llamada si viene de
# otra maquina de la red de la tienda). No requiere iniciar sesion.
#
# Uso: copiar este archivo a la PC de la tienda y correrlo con:
#   powershell -ExecutionPolicy Bypass -File forzar-sync-bodega.ps1

$apiBase = "http://127.0.0.1:3000/api"
$logPath = Join-Path $env:TEMP "rocky-maxx\service-runtime.log"

Write-Host "Verificando que el Servicio Local (backend) este arriba..." -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "$apiBase/health" -Method Get -TimeoutSec 10
    Write-Host "Backend arriba. Base de datos local: $($health.database.database)" -ForegroundColor Green
} catch {
    Write-Host "No se pudo contactar el backend local en $apiBase/health." -ForegroundColor Red
    Write-Host "Esto significa que el Servicio Local no esta corriendo (o no arranco bien) -- revisar eso primero, no tiene sentido forzar un sync sin backend." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Forzando un ciclo de bodega-export ahora mismo..." -ForegroundColor Cyan
try {
    $resultado = Invoke-RestMethod -Uri "$apiBase/bodega-export/forzar" -Method Post -TimeoutSec 30
    if ($resultado.started) {
        Write-Host "Ciclo ejecutado. Detalle: $($resultado.motivo)" -ForegroundColor Green
    } else {
        Write-Host "No se arranco un ciclo nuevo. Motivo: $($resultado.motivo)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Fallo la llamada a /bodega-export/forzar: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if (Test-Path $logPath) {
    Write-Host ""
    Write-Host "Ultimas lineas de bodega-export en el log ($logPath):" -ForegroundColor Cyan
    Get-Content $logPath -Tail 400 | Select-String -Pattern "bodega-export|BodegaExportService" | Select-Object -Last 15
} else {
    Write-Host ""
    Write-Host "No se encontro el log en $logPath (puede que el servicio corra en modo distinto)." -ForegroundColor Yellow
}

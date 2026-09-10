# Apaga el servicio local Rocky Maxx COMPLETO: la ventana de Electron
# (RockyMaxxServicioLocal.exe) Y su backend hijo (node.exe).
#
# Por que hace falta esto y no alcanza con stop-rocky-service.ps1:
# ese script solo mata RockyMaxxServicioLocal.exe (la ventana). El backend real que corre
# el ciclo de sincronizacion (Cambio de Precio, Transferencias, Devoluciones, etc.) es un
# proceso node.exe HIJO -- si se mata solo el padre, el hijo puede quedar huerfano y seguir
# corriendo en memoria con el codigo VIEJO, aunque se instale una version nueva encima. Por
# eso, despues de instalar un ejecutable nuevo, hay que apagar TODO antes de volver a abrir.
#
# Uso: correr en la PC destino con:
#   powershell -ExecutionPolicy Bypass -File stop-rocky-service-completo.ps1

Write-Host "Apagando RockyMaxxServicioLocal.exe..." -ForegroundColor Yellow
$app = Get-Process -Name "RockyMaxxServicioLocal" -ErrorAction SilentlyContinue
if ($app) {
    foreach ($p in $app) {
        Write-Host "  PID: $($p.Id)" -ForegroundColor Cyan
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  No estaba corriendo." -ForegroundColor Gray
}

Write-Host "Apagando backend (node.exe)..." -ForegroundColor Yellow
$node = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($node) {
    foreach ($p in $node) {
        Write-Host "  PID: $($p.Id)" -ForegroundColor Cyan
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  No estaba corriendo." -ForegroundColor Gray
}

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Verificando que no quede nada escuchando en los puertos de Rocky Maxx (3000-3007)..." -ForegroundColor Yellow
$stillListening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3007 }

if ($stillListening) {
    Write-Host "ATENCION: todavia hay algo escuchando en estos puertos:" -ForegroundColor Red
    $stillListening | ForEach-Object {
        Write-Host "  Puerto $($_.LocalPort) -> PID $($_.OwningProcess)" -ForegroundColor Red
    }
    Write-Host "Puede ser otro proceso legitimo (no Rocky Maxx). Revisar antes de asumir que quedo limpio." -ForegroundColor Yellow
} else {
    Write-Host "Limpio: ningun puerto 3000-3007 tiene algo escuchando." -ForegroundColor Green
}

Write-Host ""
Write-Host "Listo. Ahora se puede abrir RockyMaxxServicioLocal.exe de nuevo con el perfil que corresponda." -ForegroundColor Green

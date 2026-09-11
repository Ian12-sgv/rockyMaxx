# Chequeo de salud de la sincronizacion hacia bodega_datos, corriendo EN EL
# VPS via SSH. Compara cuantas ventas de HOY llegaron al VPS (mirror-sync)
# contra cuantas llegaron a bodega_datos por tienda, y avisa si algun cursor
# de bodega-export quedo "envenenado" con una fecha del futuro (la causa
# exacta del incidente del 10-11/9/2026, ver memoria
# project_rocky_maxx_bodega_export_clock_fix_pending).
#
# 100% de solo lectura: no escribe, no borra, no reinicia nada. Seguro para
# correr las veces que haga falta, incluso todos los dias.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\verificar-sync-bodega-datos.ps1
#
# Requiere la misma llave SSH que ya se uso en esta conversacion para hablar
# con el VPS ($HOME\.ssh\codex_rocky_vps, sin passphrase).

$sshKey = Join-Path $HOME ".ssh\codex_rocky_vps"
$vpsHost = "deploy@68.183.105.135"
$scriptRemoto = "/home/deploy/apps/rockyMaxx/scripts/vps/verificar-bodega-datos.sh"

if (-not (Test-Path $sshKey)) {
    Write-Host "No se encontro la llave SSH en $sshKey" -ForegroundColor Red
    exit 1
}

Write-Host "Conectando al VPS y corriendo el chequeo..." -ForegroundColor Cyan
Write-Host ""

& ssh -i $sshKey -o IdentitiesOnly=yes -o BatchMode=yes $vpsHost "bash $scriptRemoto"
$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "Chequeo terminado: todo OK." -ForegroundColor Green
} else {
    Write-Host "Chequeo terminado: hay algo para revisar (ver arriba)." -ForegroundColor Yellow
}

exit $exitCode

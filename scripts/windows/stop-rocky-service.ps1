$ProcessName = "RockyMaxxServicioLocal"
$ExeName = "$ProcessName.exe"

$runningProcesses = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue

if (-not $runningProcesses) {
    Write-Host "El servicio Rocky Maxx no esta corriendo." -ForegroundColor Yellow
    return
}

foreach ($process in $runningProcesses) {
    Write-Host "Apagando servicio Rocky Maxx..." -ForegroundColor Yellow
    Write-Host "PID: $($process.Id)" -ForegroundColor Cyan

    if ($process.Path) {
        Write-Host "Ruta: $($process.Path)" -ForegroundColor Cyan
    }

    Stop-Process -Id $process.Id -Force
}

Write-Host "Servicio apagado correctamente." -ForegroundColor Green

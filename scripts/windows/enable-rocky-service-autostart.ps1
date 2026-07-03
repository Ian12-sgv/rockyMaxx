$ProcessName = "RockyMaxxServicioLocal"
$ExeName = "$ProcessName.exe"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RunValueName = "RockyMaxxServicioLocalAutoStart"
$LaunchArgs = "--autostart --background --restart-backend"

function Resolve-RockyServicePath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Rocky Maxx Servicio Local\$ExeName"),
        (Join-Path $env:LOCALAPPDATA "Programs\RockyMaxxServicioLocal\$ExeName"),
        (Join-Path $env:ProgramFiles "Rocky Maxx Servicio Local\$ExeName"),
        (Join-Path $env:ProgramFiles "RockyMaxxServicioLocal\$ExeName"),
        (Join-Path ${env:ProgramFiles(x86)} "Rocky Maxx Servicio Local\$ExeName"),
        (Join-Path ${env:ProgramFiles(x86)} "RockyMaxxServicioLocal\$ExeName")
    ) | Where-Object { $_ -and $_.Trim() }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $searchRoot = Join-Path $env:LOCALAPPDATA "Programs"
    if (Test-Path $searchRoot) {
        $match = Get-ChildItem -Path $searchRoot -Filter $ExeName -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
        if ($match) {
            return $match
        }
    }

    return $null
}

$servicePath = Resolve-RockyServicePath

if (-not $servicePath) {
    Write-Host "No se encontro RockyMaxxServicioLocal.exe en las rutas normales de instalacion." -ForegroundColor Red
    Write-Host "Revisa primero la instalacion del servicio local." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $RunKey)) {
    New-Item -Path $RunKey -Force | Out-Null
}

$command = "`"$servicePath`" $LaunchArgs"
Set-ItemProperty -Path $RunKey -Name $RunValueName -Value $command

Write-Host "Autoarranque activado correctamente." -ForegroundColor Green
Write-Host "Ruta registrada: $servicePath" -ForegroundColor Cyan
Write-Host "Comando: $command" -ForegroundColor Cyan

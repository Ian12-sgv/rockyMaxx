$ProcessName = "RockyMaxxServicioLocal"
$ExeName = "$ProcessName.exe"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$StartupFolder = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$KnownRunValueNames = @(
    "Rocky Maxx Servicio Local",
    "RockyMaxxServicioLocal",
    "RockyMaxxServicioLocalAutoStart"
)
$KnownShortcutNames = @(
    "Rocky Maxx Servicio Local.lnk",
    "RockyMaxxServicioLocal.lnk"
)

function Stop-RockyService {
    $runningProcesses = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue

    if (-not $runningProcesses) {
        Write-Host "El servicio Rocky Maxx no estaba corriendo." -ForegroundColor Yellow
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
}

Stop-RockyService

if (Test-Path $RunKey) {
    foreach ($valueName in $KnownRunValueNames) {
        $property = Get-ItemProperty -Path $RunKey -Name $valueName -ErrorAction SilentlyContinue
        if ($null -ne $property) {
            Remove-ItemProperty -Path $RunKey -Name $valueName -ErrorAction SilentlyContinue
            Write-Host "Autoarranque removido: $valueName" -ForegroundColor Green
        }
    }

    $allProperties = Get-ItemProperty -Path $RunKey
    foreach ($property in $allProperties.PSObject.Properties) {
        if ($property.Name -in @("PSPath", "PSParentPath", "PSChildName", "PSDrive", "PSProvider")) {
            continue
        }

        $valueText = [string]$property.Value
        if ($valueText -like "*$ExeName*") {
            Remove-ItemProperty -Path $RunKey -Name $property.Name -ErrorAction SilentlyContinue
            Write-Host "Entrada Run removida por coincidencia: $($property.Name)" -ForegroundColor Green
        }
    }
}

foreach ($shortcutName in $KnownShortcutNames) {
    $shortcutPath = Join-Path $StartupFolder $shortcutName
    if (Test-Path $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host "Acceso directo de inicio removido: $shortcutPath" -ForegroundColor Green
    }
}

Write-Host "Autoarranque desactivado para esta sesion de Windows." -ForegroundColor Green
Write-Host "Importante: si vuelves a abrir manualmente Rocky Maxx Servicio Local 3.0.1, el programa volvera a registrarse en autoarranque." -ForegroundColor Yellow

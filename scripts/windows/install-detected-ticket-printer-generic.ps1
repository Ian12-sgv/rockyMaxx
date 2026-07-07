[CmdletBinding()]
param(
  [string]$PrinterName = "Rocky Tiqueadora Generica",
  [string]$PortName = "",
  [switch]$ForceRecreate,
  [switch]$PrintTest
)

Set-StrictMode -Version 3
$ErrorActionPreference = "Stop"

function Get-CandidateTicketDevices {
  $devices = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue)
  @(
    $devices | Where-Object {
      [string]$_.PNPDeviceID -like "USBPRINT\*" -or
      [string]$_.DeviceID -like "USBPRINT\*" -or
      [string]$_.Name -like "*POS*" -or
      [string]$_.Name -like "*ticket*" -or
      [string]$_.Name -like "*tique*" -or
      [string]$_.Name -like "*thermal*" -or
      [string]$_.Name -like "*receipt*" -or
      [string]$_.Name -like "*printer*"
    }
  )
}

function Resolve-UsbPrinterPort {
  param([object[]]$Devices)

  foreach ($device in $Devices) {
    $sources = @(
      [string]$device.PNPDeviceID,
      [string]$device.DeviceID,
      [string]$device.Name
    )

    foreach ($source in $sources) {
      if ([string]::IsNullOrWhiteSpace($source)) {
        continue
      }

      $match = [regex]::Match($source, "USB\d{3}", "IgnoreCase")
      if ($match.Success) {
        return $match.Value.ToUpperInvariant()
      }
    }
  }

  throw "No se detecto un puerto USBxxx para la tiqueadora. Conecta la impresora y espera a que Windows la vea."
}

function Ensure-PrinterQueue {
  param(
    [string]$QueueName,
    [string]$UsbPort,
    [switch]$ReplaceExisting
  )

  $existing = Get-Printer -Name $QueueName -ErrorAction SilentlyContinue
  if ($existing -and $ReplaceExisting) {
    Remove-Printer -Name $QueueName -ErrorAction Stop
    Start-Sleep -Seconds 2
    $existing = $null
  }

  if ($existing) {
    return $existing
  }

  $driverInf = Join-Path $env:windir "INF\ntprint.inf"
  if (-not (Test-Path $driverInf)) {
    throw "No se encontro ntprint.inf en $driverInf."
  }

  rundll32 printui.dll,PrintUIEntry /if /b $QueueName /f $driverInf /r $UsbPort /m "Generic / Text Only"
  Start-Sleep -Seconds 4

  $created = Get-Printer -Name $QueueName -ErrorAction SilentlyContinue
  if (-not $created) {
    throw "No se pudo crear la cola generica para la tiqueadora."
  }

  return $created
}

function Send-TestTicket {
  param(
    [string]$QueueName,
    [string]$UsbPort
  )

  $testPath = Join-Path $env:USERPROFILE "Downloads\rocky-pos-test.txt"
  @"
ROCKY MAXX
PRUEBA GENERAL DE TIQUEADORA
--------------------------------
Esta impresion se envio por Generic / Text Only
Puerto: $UsbPort
Cola: $QueueName
--------------------------------
Si este ticket salio, la configuracion general funciona.
"@ | Set-Content -Path $testPath -Encoding ASCII

  Get-Content $testPath | Out-Printer -Name $QueueName
  return $testPath
}

$devices = @(Get-CandidateTicketDevices)
if (-not $devices.Count) {
  throw "Windows no detecta ninguna tiqueadora o dispositivo USBPRINT en este momento."
}

if ([string]::IsNullOrWhiteSpace($PortName)) {
  $PortName = Resolve-UsbPrinterPort -Devices $devices
}

$printer = Ensure-PrinterQueue -QueueName $PrinterName -UsbPort $PortName -ReplaceExisting:$ForceRecreate

Write-Host ""
Write-Host "Tiqueadora configurada." -ForegroundColor Green
Write-Host "Nombre : $($printer.Name)" -ForegroundColor Green
Write-Host "Driver : $($printer.DriverName)" -ForegroundColor Green
Write-Host "Puerto : $($printer.PortName)" -ForegroundColor Green

if ($PrintTest) {
  $testFile = Send-TestTicket -QueueName $printer.Name -UsbPort $PortName
  Write-Host "Prueba enviada: $testFile" -ForegroundColor Yellow
}

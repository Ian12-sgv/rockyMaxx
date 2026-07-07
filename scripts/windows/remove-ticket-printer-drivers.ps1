[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]]$PrinterNamePatterns = @(
    "POS-80*",
    "DP8UBT*",
    "Rocky Tiqueadora Generica",
    "*tiqueadora*",
    "*ticket*",
    "*thermal*"
  ),
  [string[]]$DriverNamePatterns = @(
    "POS-80*",
    "DP8UBT*",
    "*XPrinter*",
    "*BIXOLON*",
    "*Rongta*",
    "*GPrinter*",
    "*Bematech*",
    "*Datecs*",
    "*Sewoo*"
  ),
  [switch]$IncludeGenericTextOnly,
  [switch]$OnlyQueues
)

Set-StrictMode -Version 3
$ErrorActionPreference = "Stop"

function Test-MatchesAnyPattern {
  param(
    [string]$Value,
    [string[]]$Patterns
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  foreach ($pattern in $Patterns) {
    if ([string]::IsNullOrWhiteSpace($pattern)) {
      continue
    }

    if ($Value -like $pattern) {
      return $true
    }
  }

  return $false
}

if ($IncludeGenericTextOnly) {
  $DriverNamePatterns += "Generic / Text Only"
}

$removedPrinters = New-Object System.Collections.Generic.List[object]
$removedDrivers = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[object]

$printers = @(Get-Printer -ErrorAction SilentlyContinue)
$targetPrinters = @(
  $printers | Where-Object {
    Test-MatchesAnyPattern -Value ([string]$_.Name) -Patterns $PrinterNamePatterns -or
    Test-MatchesAnyPattern -Value ([string]$_.DriverName) -Patterns $DriverNamePatterns
  }
)

foreach ($printer in $targetPrinters) {
  try {
    if ($PSCmdlet.ShouldProcess($printer.Name, "Remove-Printer")) {
      Remove-Printer -Name $printer.Name -ErrorAction Stop
    }

    $removedPrinters.Add([pscustomobject]@{
      Name = [string]$printer.Name
      DriverName = [string]$printer.DriverName
      PortName = [string]$printer.PortName
      Status = "Removed"
    }) | Out-Null
  } catch {
    $errors.Add([pscustomobject]@{
      Type = "Printer"
      Name = [string]$printer.Name
      Message = $_.Exception.Message
    }) | Out-Null
  }
}

if (-not $OnlyQueues) {
  Start-Sleep -Seconds 2

  $currentPrinters = @(Get-Printer -ErrorAction SilentlyContinue)
  $candidateDriverNames = @(
    $targetPrinters |
      ForEach-Object { [string]$_.DriverName } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )

  $matchingDrivers = @(
    Get-PrinterDriver -ErrorAction SilentlyContinue |
      Where-Object {
        Test-MatchesAnyPattern -Value ([string]$_.Name) -Patterns $DriverNamePatterns
      } |
      Select-Object -ExpandProperty Name
  )

  $driverNames = @($candidateDriverNames + $matchingDrivers | Sort-Object -Unique)

  foreach ($driverName in $driverNames) {
    try {
      $stillUsed = $currentPrinters | Where-Object { [string]$_.DriverName -eq [string]$driverName }
      if ($stillUsed) {
        $errors.Add([pscustomobject]@{
          Type = "Driver"
          Name = [string]$driverName
          Message = "No se elimino porque todavia esta en uso por otra impresora."
        }) | Out-Null
        continue
      }

      if ($PSCmdlet.ShouldProcess($driverName, "Remove-PrinterDriver")) {
        Remove-PrinterDriver -Name $driverName -ErrorAction Stop
      }

      $removedDrivers.Add([pscustomobject]@{
        Name = [string]$driverName
        Status = "Removed"
      }) | Out-Null
    } catch {
      $errors.Add([pscustomobject]@{
        Type = "Driver"
        Name = [string]$driverName
        Message = $_.Exception.Message
      }) | Out-Null
    }
  }
}

Write-Host ""
Write-Host "Impresoras eliminadas:" -ForegroundColor Cyan
if ($removedPrinters.Count -gt 0) {
  $removedPrinters | Format-Table -AutoSize
} else {
  Write-Host "Ninguna." -ForegroundColor Yellow
}

if (-not $OnlyQueues) {
  Write-Host ""
  Write-Host "Drivers eliminados:" -ForegroundColor Cyan
  if ($removedDrivers.Count -gt 0) {
    $removedDrivers | Format-Table -AutoSize
  } else {
    Write-Host "Ninguno." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Observaciones:" -ForegroundColor Cyan
if ($errors.Count -gt 0) {
  $errors | Format-Table -AutoSize
} else {
  Write-Host "Sin observaciones." -ForegroundColor Green
}

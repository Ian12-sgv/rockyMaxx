param(
  [Parameter(Position = 0)]
  [ValidateSet("prod")]
  [string]$Mode = "prod"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$apiDir = (Resolve-Path (Join-Path $repoRoot "apps\\api")).Path
$envFile = Join-Path $apiDir ".env.tienda001"

if (-not (Test-Path $envFile)) {
  throw "No existe el archivo de entorno para tienda 001: $envFile"
}

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $parts = $line.Split("=", 2)
  if ($parts.Count -ne 2) {
    return
  }

  $name = $parts[0].Trim()
  $value = $parts[1].Trim().Trim('"')
  [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
}

Push-Location $repoRoot
try {
  Write-Host "[rocky-maxx] Arrancando API tienda 001 en puerto $env:API_PORT..."
  & "C:\Program Files\nodejs\node.exe" "apps/api/dist/main.js"
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}

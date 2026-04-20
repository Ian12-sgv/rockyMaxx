param(
  [Parameter(Position = 0)]
  [ValidateSet("dev", "prod")]
  [string]$Mode = "dev",
  [switch]$SkipInstall,
  [switch]$SkipPrismaGenerate,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$apiDir = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\apps\\api")).Path
$setupScript = Join-Path $PSScriptRoot "instalar-y-validar.ps1"
$setupArgs = @()

if ($SkipInstall) {
  $setupArgs += "-SkipInstall"
}

if ($SkipPrismaGenerate) {
  $setupArgs += "-SkipPrismaGenerate"
}

if ($SkipBuild) {
  $setupArgs += "-SkipBuild"
}

# Reusa el flujo de preparacion antes del arranque real.
& $setupScript @setupArgs

Push-Location $apiDir
try {
  if ($Mode -eq "dev") {
    Write-Host "[herrmaineats] Arrancando API en modo desarrollo..."
    npm run start:dev
  }
  else {
    Write-Host "[herrmaineats] Arrancando API en modo produccion..."
    npm run start
  }
}
finally {
  Pop-Location
}

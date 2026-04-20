param(
  [switch]$SkipInstall,
  [switch]$SkipPrismaGenerate,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$apiDir = Join-Path $repoRoot "apps\\api"
$apiEnv = Join-Path $apiDir ".env"
$rootEnv = Join-Path $repoRoot ".env"
$apiEnvExample = Join-Path $apiDir ".env.example"
$preflightScript = Join-Path $PSScriptRoot "preflight.ps1"

if (-not (Test-Path $apiEnv) -and -not (Test-Path $rootEnv) -and (Test-Path $apiEnvExample)) {
  Copy-Item -LiteralPath $apiEnvExample -Destination $apiEnv
  Write-Host "[herrmaineats] Se creo apps/api/.env desde apps/api/.env.example"
}

& $preflightScript

Push-Location $repoRoot
try {
  if (-not $SkipInstall) {
    Write-Host "[herrmaineats] Ejecutando npm install en la raiz del workspace..."
    npm install
  }
}
finally {
  Pop-Location
}

Push-Location $apiDir
try {
  if (-not $SkipPrismaGenerate) {
    Write-Host "[herrmaineats] Generando Prisma Client..."
    npm run prisma:generate
  }

  if (-not $SkipBuild) {
    Write-Host "[herrmaineats] Compilando API..."
    npm run build
  }
}
finally {
  Pop-Location
}

Write-Host "[herrmaineats] Instalacion y validacion completadas."

param()

$ErrorActionPreference = "Stop"

function Load-EnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $values = @{}

  foreach ($rawLine in Get-Content -Path $Path) {
    $line = $rawLine.Trim()

    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    if ($line.StartsWith("#")) {
      continue
    }

    $parts = $line -split "=", 2

    if ($parts.Count -ne 2) {
      continue
    }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
  }

  return $values
}

function Test-TcpPort {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HostName,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient

  try {
    $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $asyncResult.AsyncWaitHandle.WaitOne(3000, $false)

    if (-not $connected) {
      return $false
    }

    $client.EndConnect($asyncResult) | Out-Null
    return $true
  }
  catch {
    return $false
  }
  finally {
    $client.Close()
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$apiDir = Join-Path $repoRoot "apps\\api"
$apiEnv = Join-Path $apiDir ".env"
$rootEnv = Join-Path $repoRoot ".env"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js no esta instalado o no esta en PATH."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm no esta instalado o no esta en PATH."
}

$envPath = $null

if (Test-Path $apiEnv) {
  $envPath = $apiEnv
}
elseif (Test-Path $rootEnv) {
  $envPath = $rootEnv
}

if (-not $envPath) {
  throw "No se encontro ningun archivo .env. Usa apps/api/.env.example como base."
}

$envValues = Load-EnvFile -Path $envPath
$required = @(
  "DATABASE_URL",
  "API_PORT",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "AUTH_PASSWORD_PEPPER",
  "AUTH_BOOTSTRAP_ADMIN_ENABLED",
  "AUTH_BOOTSTRAP_ADMIN_USERNAME",
  "AUTH_BOOTSTRAP_ADMIN_NAME",
  "AUTH_BOOTSTRAP_ADMIN_PASSWORD",
  "AUTH_BOOTSTRAP_ADMIN_GROUP"
)

$missing = @()

foreach ($key in $required) {
  if (-not $envValues.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envValues[$key])) {
    $missing += $key
  }
}

if ($missing.Count -gt 0) {
  throw ("Faltan variables requeridas en {0}: {1}" -f $envPath, ($missing -join ", "))
}

$databaseUrl = $envValues["DATABASE_URL"]
$dbHost = $null
$dbPort = 5432

try {
  $dbUri = [System.Uri]$databaseUrl
  $dbHost = $dbUri.Host

  if ($dbUri.Port -gt 0) {
    $dbPort = $dbUri.Port
  }
}
catch {
  Write-Warning "No se pudo parsear DATABASE_URL para probar conectividad TCP."
}

$nodeVersion = node -v
$npmVersion = npm -v

Write-Host "[herrmaineats] Repo: $repoRoot"
Write-Host "[herrmaineats] API dir: $apiDir"
Write-Host "[herrmaineats] Env usado: $envPath"
Write-Host "[herrmaineats] Node: $nodeVersion"
Write-Host "[herrmaineats] npm: $npmVersion"
Write-Host "[herrmaineats] API_PORT: $($envValues["API_PORT"])"

if ($dbHost) {
  $tcpOk = Test-TcpPort -HostName $dbHost -Port $dbPort

  if ($tcpOk) {
    Write-Host "[herrmaineats] PostgreSQL TCP reachable: ${dbHost}:$dbPort"
  }
  else {
    Write-Warning "[herrmaineats] No hubo respuesta TCP desde ${dbHost}:$dbPort. La API no levantara si la base sigue fuera de linea."
  }
}

Write-Host "[herrmaineats] Preflight completado."

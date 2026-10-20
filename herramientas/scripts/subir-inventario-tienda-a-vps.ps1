<#
.SYNOPSIS
  Sube TODO el inventario de una tienda o bodega a su respaldo (gemela) en el VPS.

.DESCRIPTION
  Para cuando se cambiaron existencias (u otros datos de INVENTARIO) con una
  consulta directa en PostgreSQL: esos cambios NO se suben solos, porque
  MirrorSync solo envia lo que la aplicacion anota en su cola al guardar desde
  la interfaz.

  Se corre EN LA PC DE LA TIENDA. Lee su inventario (solo SELECT, no modifica
  la base local), arma el mismo paquete INVENTORY_UPSERT que arma la
  aplicacion (MirrorSyncService.buildInventoryUpsertEnvelope) y lo envia en
  lotes de 25 a <URL VPS de la tienda>/api/transfers/inventory-bulk/import,
  que aplica cada paquete igual que MirrorSync. La gemela del VPS sobrescribe
  cada articulo con lo que llega, asi que al terminar queda igual a la tienda.

  Toma la base, la URL del VPS y el usuario de sincronizacion del perfil .env
  del Servicio Local instalado (no hay claves escritas en este script).

.PARAMETER Tienda
  Codigo del nodo. Tienda: 007 -> base rocky_tienda_007. Bodega: B002 -> base
  rocky_bodega_002 (vale igual para B003, etc.). Se corre en la PC de ese nodo.

.PARAMETER EnvFile
  Ruta del .env a usar, si no se quiere la busqueda automatica.

.PARAMETER SoloContar
  Solo muestra base, destino y cantidad de articulos; no envia nada.

.PARAMETER GuardarEn
  Guarda los paquetes (uno por linea, JSON) en ese archivo y termina sin
  enviar nada. Sirve para revisar que se va a mandar.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\subir-inventario-tienda-a-vps.ps1 -Tienda 007 -SoloContar
  powershell -ExecutionPolicy Bypass -File .\subir-inventario-tienda-a-vps.ps1 -Tienda 007
  powershell -ExecutionPolicy Bypass -File .\subir-inventario-tienda-a-vps.ps1 -Tienda B002 -SoloContar
#>
param(
  [string]$Tienda = "007",
  [string]$EnvFile = "",
  [switch]$SoloContar,
  [string]$GuardarEn = "",
  [ValidateRange(1, 25)]
  [int]$Lote = 25
)

$ErrorActionPreference = "Stop"
$Tienda = $Tienda.Trim().ToUpper()
if ($Tienda -match "^B(\d+)$") {
  # Bodega: B002 -> rocky_bodega_002
  $numero = $Matches[1].PadLeft(3, "0")
  $Tienda = "B$numero"
  $baseEsperada = "rocky_bodega_$numero"
} elseif ($Tienda -match "^\d+$") {
  $Tienda = $Tienda.PadLeft(3, "0")
  $baseEsperada = "rocky_tienda_$Tienda"
} else {
  throw "Codigo '$Tienda' invalido. Usa el numero de la tienda (ej. 007) o B + numero de bodega (ej. B002)."
}

function Read-EnvFile([string]$path) {
  $vars = @{}
  foreach ($line in [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)) {
    $l = $line.TrimStart([char]0xFEFF).Trim()
    if (-not $l -or $l.StartsWith("#")) { continue }
    $idx = $l.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $l.Substring(0, $idx).Trim()
    $value = $l.Substring($idx + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $vars[$key] = $value
  }
  return $vars
}

function Get-DatabaseName([string]$url) {
  if ($url -match "/([^/?]+)(\?|$)") { return $Matches[1] }
  return ""
}

# ---- 1. Perfil .env de la tienda --------------------------------------------
if (-not $EnvFile) {
  $runtimeDir = Join-Path $env:LOCALAPPDATA "Programs\@sistema-arabedesktop-service\resources\api"
  if (-not (Test-Path $runtimeDir)) {
    throw "No se encontro el Servicio Local instalado en $runtimeDir. Indica el perfil con -EnvFile."
  }
  $candidatos = Get-ChildItem -Path $runtimeDir -Force -File -Filter ".env*" |
    Where-Object { $_.Name -notlike "*.example" -and $_.Name -notlike "*.bak*" } |
    Where-Object {
      $vars = Read-EnvFile $_.FullName
      (Get-DatabaseName $vars["DATABASE_URL"]) -eq $baseEsperada
    }
  if (@($candidatos).Count -eq 0) {
    throw "Ningun perfil en $runtimeDir usa la base $baseEsperada. Indica el perfil con -EnvFile."
  }
  $EnvFile = @($candidatos)[0].FullName
}

$envVars = Read-EnvFile $EnvFile
$databaseUrl = $envVars["DATABASE_URL"]
$remoteUrl = ($envVars["MIRROR_SYNC_REMOTE_API_URL"]).TrimEnd("/")
$usuario = $envVars["MIRROR_SYNC_USERNAME"]
$password = $envVars["MIRROR_SYNC_PASSWORD"]
$baseDatos = Get-DatabaseName $databaseUrl

if ($baseDatos -ne $baseEsperada) {
  throw "El perfil $EnvFile usa la base '$baseDatos', no '$baseEsperada'."
}
if ($baseDatos -like "*_vps") {
  throw "La base '$baseDatos' es una gemela del VPS: este script se corre en la PC de la tienda o bodega."
}
if (-not $remoteUrl -or -not $usuario -or -not $password) {
  throw "Al perfil $EnvFile le falta MIRROR_SYNC_REMOTE_API_URL, MIRROR_SYNC_USERNAME o MIRROR_SYNC_PASSWORD."
}

# ---- 2. psql -----------------------------------------------------------------
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) {
  $psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $psql) {
  throw "No se encontro psql.exe (PostgreSQL). Instalalo o agregalo al PATH."
}
# psql no entiende el parametro ?schema=dbo de Prisma.
$psqlUrl = ($databaseUrl -split "\?")[0]

# ---- 3. Lectura del inventario (solo SELECT) --------------------------------
# Mismo paquete que MirrorSyncService.buildInventoryUpsertEnvelope: Prisma lee
# las fechas de INVENTARIO (timestamp sin zona) como UTC y las manda con
# toISOString(); por eso la sesion va en UTC y el formato termina en "Z".
$sql = @"
SET TIME ZONE 'UTC';
WITH seed AS (
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS epoch_ms
),
base AS (
  SELECT inv.*,
         mar."Codigo" AS marca_codigo, mar."Nombre" AS marca_nombre, mar."Status" AS marca_status,
         tal."Codigo" AS talla_codigo,
         col."Codigo" AS color_codigo, col."Nombre" AS color_nombre, col."Status" AS color_status,
         fab."Codigo" AS fabricante_codigo, fab."Nombre" AS fabricante_nombre, fab."Status" AS fabricante_status,
         cat."Codigo" AS categoria_codigo, cat."Nombre" AS categoria_nombre, cat."Status" AS categoria_status,
         imp."Codigo" AS impuesto_codigo, imp."Nombre" AS impuesto_nombre, imp."PorcentajeImpuesto" AS impuesto_porcentaje,
         row_number() OVER (ORDER BY inv."CodigoBarra") AS row_no
  FROM dbo."INVENTARIO" inv
  JOIN dbo."MARCAS" mar ON mar."Codigo" = inv."CodigoMarca"
  JOIN dbo."TALLAS" tal ON tal."Codigo" = inv."Talla"
  JOIN dbo."COLORES" col ON col."Codigo" = inv."CodigoColor"
  JOIN dbo."FABRICANTES" fab ON fab."Codigo" = inv."Fabricante"
  JOIN dbo."CATEGORIAS" cat ON cat."Codigo" = inv."Categoria"
  JOIN dbo."IMPUESTOS" imp ON imp."Codigo" = inv."TipoImpuesto"
),
prepared AS (
  SELECT upper('$baseDatos') || '-INVENTORY-' || base."CodigoBarra" || '-' || (seed.epoch_ms + base.row_no)::text AS global_id,
         base.*
  FROM base CROSS JOIN seed
)
-- translate(): encode(..., 'base64') parte el texto en lineas de 76
-- caracteres; sin esto cada articulo llegaria en varias lineas y cortado.
SELECT prepared.global_id,
       translate(encode(convert_to(jsonb_build_object(
         'schemaVersion', 1,
         'globalId', prepared.global_id,
         'sourceDatabase', '$baseDatos',
         'entityType', 'INVENTORY',
         'entityKey', prepared."CodigoBarra",
         'eventType', 'INVENTORY_UPSERT',
         'inventory', jsonb_build_object(
           'codigoBarra', prepared."CodigoBarra",
           'codigoBarraAnt', prepared."CodigoBarraAnt",
           'referencia', prepared."Referencia",
           'codigoMarca', prepared."CodigoMarca",
           'nombre', prepared."Nombre",
           'talla', prepared."Talla",
           'codigoColor', prepared."CodigoColor",
           'fabricante', prepared."Fabricante",
           'categoria', prepared."Categoria",
           'nota', prepared."Nota",
           'tipoImpuesto', prepared."TipoImpuesto",
           'precioDetal', coalesce(prepared."PrecioDetal", 0)::text,
           'precioMayor', coalesce(prepared."PrecioMayor", 0)::text,
           'precioAfiliado', coalesce(prepared."PrecioAfiliado", 0)::text,
           'precioPromocion', coalesce(prepared."PrecioPromocion", 0)::text,
           'promocion', coalesce(prepared."Promocion", false),
           'fechaInicial', to_char(coalesce(prepared."FechaInicial", prepared."UltimaActualizacion", now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'fechaFinal', to_char(coalesce(prepared."FechaFinal", prepared."FechaInicial", prepared."UltimaActualizacion", now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'costoInicial', coalesce(prepared."CostoInicial", 0)::text,
           'costoPromedio', coalesce(prepared."CostoPromedio", 0)::text,
           'ultimoCosto', coalesce(prepared."UltimoCosto", 0)::text,
           'costoDolar', coalesce(prepared."CostoDolar", 0)::text,
           'existenciaInicial', coalesce(prepared."ExistenciaInicial", 0)::text,
           'existencia', coalesce(prepared."Existencia", 0)::text,
           'puntoReorden', coalesce(prepared."PuntoReorden", 0)::text,
           'fechaPrimerMovimiento', to_char(coalesce(prepared."FechaPrimerMovimiento", prepared."FechaInicial", prepared."UltimaActualizacion", now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'ultimaActualizacion', to_char(coalesce(prepared."UltimaActualizacion", prepared."FechaFinal", prepared."FechaInicial", now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'tipo', coalesce(prepared."Tipo", 0),
           'status', coalesce(prepared."Status", 0),
           'serializado', coalesce(prepared."Serializado", 0)
         ),
         'catalogs', jsonb_build_object(
           'marca', jsonb_build_object('codigo', prepared.marca_codigo, 'nombre', prepared.marca_nombre, 'status', prepared.marca_status),
           'talla', jsonb_build_object('codigo', prepared.talla_codigo),
           'color', jsonb_build_object('codigo', prepared.color_codigo, 'nombre', prepared.color_nombre, 'status', prepared.color_status),
           'fabricante', jsonb_build_object('codigo', prepared.fabricante_codigo, 'nombre', prepared.fabricante_nombre, 'status', prepared.fabricante_status),
           'categoria', jsonb_build_object('codigo', prepared.categoria_codigo, 'nombre', prepared.categoria_nombre, 'status', prepared.categoria_status),
           'impuesto', jsonb_build_object('codigo', prepared.impuesto_codigo, 'nombre', prepared.impuesto_nombre,
             'porcentajeImpuesto', CASE WHEN prepared.impuesto_porcentaje IS NULL THEN NULL ELSE prepared.impuesto_porcentaje::text END)
         )
       )::text, 'UTF8'), 'base64'), chr(10) || chr(13), '') AS payload_b64
FROM prepared
ORDER BY prepared."CodigoBarra";
"@

$sqlFile = Join-Path $env:TEMP "subir-inventario-$Tienda.sql"
[System.IO.File]::WriteAllText($sqlFile, $sql, (New-Object System.Text.UTF8Encoding($false)))
$env:PGCLIENTENCODING = "UTF8"
$filas = & $psql $psqlUrl -X -q -At -F "`t" -v ON_ERROR_STOP=1 -f $sqlFile
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo leer el inventario de $baseDatos (psql salio con codigo $LASTEXITCODE)."
}
Remove-Item $sqlFile -ErrorAction SilentlyContinue

$paquetes = New-Object System.Collections.Generic.List[string]
foreach ($fila in $filas) {
  if ([string]::IsNullOrWhiteSpace($fila)) { continue }
  $partes = $fila -split "`t", 2
  if ($partes.Count -lt 2) { continue }
  $base64 = ($partes[1] -replace "\s", "")
  $paquetes.Add([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($base64)))
}

# Por archivo y no con -c: PowerShell 5.1 le quita las comillas dobles a los
# argumentos de programas externos y dbo."INVENTARIO" llegaria sin comillas.
$conteoFile = Join-Path $env:TEMP "subir-inventario-$Tienda-conteo.sql"
[System.IO.File]::WriteAllText($conteoFile, 'SELECT COUNT(*) FROM dbo."INVENTARIO";', (New-Object System.Text.UTF8Encoding($false)))
$totalInventario = ([string](& $psql $psqlUrl -X -q -At -v ON_ERROR_STOP=1 -f $conteoFile)).Trim()
Remove-Item $conteoFile -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0 -or -not $totalInventario) {
  throw "No se pudo contar el inventario de $baseDatos."
}

Write-Host ""
Write-Host "Perfil      : $EnvFile"
Write-Host "Base local  : $baseDatos (solo lectura)"
Write-Host "Destino VPS : $remoteUrl"
Write-Host "Articulos   : $($paquetes.Count) a enviar (INVENTARIO tiene $totalInventario)"
if ([int]$totalInventario -ne $paquetes.Count) {
  Write-Warning "Hay articulos con marca/talla/color/fabricante/categoria/impuesto inexistente: no se envian (la aplicacion tampoco podria)."
}

if ($GuardarEn) {
  [System.IO.File]::WriteAllLines($GuardarEn, $paquetes, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "`nPaquetes guardados en $GuardarEn. No se envio nada."
  exit 0
}
if ($SoloContar) {
  Write-Host "`n-SoloContar: no se envio nada."
  exit 0
}
if ($paquetes.Count -eq 0) {
  Write-Host "No hay articulos para enviar."
  exit 0
}

$respuesta = Read-Host "`nEscribe SI para enviar los $($paquetes.Count) articulos al respaldo del VPS"
if ($respuesta -ne "SI") {
  Write-Host "Cancelado, no se envio nada."
  exit 0
}

# ---- 4. Envio ----------------------------------------------------------------
function Get-Token {
  $body = @{ usuario = $usuario; password = $password } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod -Uri "$remoteUrl/api/auth/login" -Method Post -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
  if (-not $login.accessToken) { throw "El VPS no devolvio token al iniciar sesion como $usuario." }
  return $login.accessToken
}

$logDir = Join-Path $env:TEMP "rocky-maxx"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("subir-inventario-$Tienda-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
"Inicio $(Get-Date -Format s) base=$baseDatos destino=$remoteUrl articulos=$($paquetes.Count)" | Out-File $logFile -Encoding utf8

$token = Get-Token
$enviados = 0
$importados = 0
$fallidos = New-Object System.Collections.Generic.List[string]

for ($i = 0; $i -lt $paquetes.Count; $i += $Lote) {
  $fin = [Math]::Min($i + $Lote, $paquetes.Count) - 1
  $lote = $paquetes.GetRange($i, $fin - $i + 1).ToArray()
  $body = '{"items":[' + ($lote -join ",") + ']}'
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

  $ok = $false
  for ($intento = 1; $intento -le 3 -and -not $ok; $intento++) {
    try {
      $resp = Invoke-RestMethod -Uri "$remoteUrl/api/transfers/inventory-bulk/import" -Method Post `
        -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 120
      $importados += [int]$resp.imported
      $ok = $true
    } catch {
      $mensaje = $_.Exception.Message
      if ($mensaje -match "401") { $token = Get-Token }
      if ($intento -eq 3) {
        $codigos = ($lote | ForEach-Object { ($_ | ConvertFrom-Json).entityKey }) -join ","
        $fallidos.Add("articulos $($i + 1)-$($fin + 1) [$codigos]: $mensaje")
        "FALLO $($i + 1)-$($fin + 1): $mensaje" | Out-File $logFile -Append -Encoding utf8
      } else {
        Start-Sleep -Seconds (2 * $intento)
      }
    }
  }
  $enviados = $fin + 1
  if ((($i / $Lote) % 20) -eq 0 -or $enviados -eq $paquetes.Count) {
    Write-Host ("  {0}/{1} enviados, {2} aplicados en el VPS" -f $enviados, $paquetes.Count, $importados)
  }
}

$resumen = "Fin $(Get-Date -Format s) enviados=$enviados aplicados=$importados lotes_fallidos=$($fallidos.Count)"
$resumen | Out-File $logFile -Append -Encoding utf8
Write-Host ""
Write-Host $resumen
if ($fallidos.Count -gt 0) {
  Write-Warning "Lotes que fallaron (vuelve a correr el script para reintentarlos):"
  $fallidos | Select-Object -First 10 | ForEach-Object { Write-Warning "  $_" }
}
Write-Host "Registro: $logFile"

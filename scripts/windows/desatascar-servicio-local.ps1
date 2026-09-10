# "Desatascar" el Servicio Local Rocky Maxx: apaga la ventana de Electron (RockyMaxxServicioLocal.exe)
# Y su backend hijo (node.exe) -- igual que stop-rocky-service-completo.ps1, porque matar solo el
# padre deja al hijo huerfano corriendo en memoria -- y despues lo vuelve a levantar solo. Al final
# verifica VENTAS, INVENTARIO y TRANSFERENCIAS: si alguna sigue sin subir al VPS, muestra el error
# exacto (no solo "algo fallo") para poder corregir la causa real.
#
# Cuando usarlo: cuando la tienda dejo de sincronizar ventas hacia bodega de datos (o cualquier otro
# sync: transferencias, devoluciones, cambios de precio) y no se sabe por que -- reiniciar limpia
# cualquier candado interno que se haya quedado trabado en memoria (ej. una conexion de red colgada),
# sin importar la version instalada.
#
# Requiere una version del Servicio Local que incluya GET /api/bodega-export/estado (3.1.12 o
# posterior). En versiones anteriores, los pasos 1-4 (apagar y reabrir) funcionan igual, pero el
# paso 5 (verificacion) no va a poder consultar el estado.
#
# Uso: copiar este archivo a la PC de la tienda y correrlo con:
#   powershell -ExecutionPolicy Bypass -File desatascar-servicio-local.ps1

$processName = "RockyMaxxServicioLocal"
$apiBase = "http://127.0.0.1:3000/api"
$healthUrl = "$apiBase/health"

Write-Host "=== Paso 1/4: localizando el Servicio Local ===" -ForegroundColor Cyan
$app = Get-Process -Name $processName -ErrorAction SilentlyContinue
$exePath = $null
if ($app) {
    $exePath = ($app | Select-Object -First 1).Path
    Write-Host "Encontrado corriendo. Ejecutable: $exePath" -ForegroundColor Green
} else {
    Write-Host "No esta corriendo ahora mismo. Buscando el ejecutable instalado..." -ForegroundColor Yellow
    $candidato = Get-ChildItem -Path "$env:LOCALAPPDATA\Programs" -Filter "$processName.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidato) {
        $exePath = $candidato.FullName
        Write-Host "Encontrado instalado en: $exePath" -ForegroundColor Green
    } else {
        Write-Host "No se encontro el ejecutable instalado en $env:LOCALAPPDATA\Programs. Hay que abrirlo a mano." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=== Paso 2/4: apagando todo (ventana + backend) ===" -ForegroundColor Cyan
if ($app) {
    foreach ($p in $app) {
        Write-Host "  Apagando $processName PID $($p.Id)..." -ForegroundColor Yellow
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
}
$node = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($node) {
    foreach ($p in $node) {
        Write-Host "  Apagando node.exe (backend) PID $($p.Id)..." -ForegroundColor Yellow
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  No habia ningun node.exe corriendo." -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Paso 3/4: esperando que los puertos queden libres ===" -ForegroundColor Cyan
$intentos = 0
do {
    Start-Sleep -Seconds 2
    $ocupados = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3007 }
    $intentos++
} while ($ocupados -and $intentos -lt 10)

if ($ocupados) {
    Write-Host "ATENCION: todavia hay algo escuchando en el puerto 3000-3007 despues de 20 segundos. Puede ser otro programa. Se va a intentar abrir igual." -ForegroundColor Red
    $ocupados | ForEach-Object { Write-Host "  Puerto $($_.LocalPort) -> PID $($_.OwningProcess)" -ForegroundColor Red }
} else {
    Write-Host "Puertos libres." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Paso 4/5: volviendo a abrir el Servicio Local ===" -ForegroundColor Cyan
Start-Process -FilePath $exePath
Write-Host "Abierto. Esperando a que el backend responda..." -ForegroundColor Yellow

$listo = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 5
        if ($health.status -eq "ok") {
            $listo = $true
            break
        }
    } catch {
        # todavia arrancando, seguir esperando
    }
}

Write-Host ""
if ($listo) {
    Write-Host "LISTO: el Servicio Local volvio a responder en $healthUrl. Base de datos: $($health.database.database)" -ForegroundColor Green
} else {
    Write-Host "El Servicio Local se abrio pero no respondio en $healthUrl despues de 30 segundos. Puede necesitar seleccionar el perfil de tienda a mano (deberia aparecer una ventana)." -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Paso 5/5: verificando que VENTAS, INVENTARIO y TRANSFERENCIAS esten subiendo al VPS ===" -ForegroundColor Cyan

if (-not $listo) {
    Write-Host "Como el backend no respondio, no se puede verificar el estado de sync." -ForegroundColor Yellow
    exit 1
}

Write-Host "Esperando 30 segundos para que el backend alcance a intentar al menos un ciclo de cada sync..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

$estado = $null
try {
    $estado = Invoke-RestMethod -Uri "$apiBase/bodega-export/estado" -Method Get -TimeoutSec 10
} catch {
    Write-Host "No se pudo consultar $apiBase/bodega-export/estado : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "(Si esta instancia todavia tiene una version anterior a la 3.1.12, este endpoint no existe todavia -- no es un error de la tienda.)" -ForegroundColor Yellow
}

if ($estado) {
    $checks = @(
        @{ Etiqueta = "VENTAS";         Clave = "bodega-export:VENTAS" },
        @{ Etiqueta = "INVENTARIO";     Clave = "bodega-export:INVENTARIO" },
        @{ Etiqueta = "TRANSFERENCIAS"; Clave = "transfers" }
    )

    $huboProblemas = $false

    foreach ($check in $checks) {
        $entry = $estado.($check.Clave)
        Write-Host ""
        Write-Host "--- $($check.Etiqueta) ---" -ForegroundColor Cyan

        if (-not $entry) {
            Write-Host "SIN DATOS: no se registro ningun intento todavia (puede necesitar mas tiempo, o este modulo esta deshabilitado en este perfil)." -ForegroundColor Yellow
            continue
        }

        $ultimoExito = $entry.lastSuccessAt
        $ultimoError = $entry.lastErrorAt
        $errorEsMasReciente = $false
        if ($ultimoError) {
            if (-not $ultimoExito -or ([datetime]$ultimoError -gt [datetime]$ultimoExito)) {
                $errorEsMasReciente = $true
            }
        }

        if ($errorEsMasReciente) {
            $huboProblemas = $true
            Write-Host "FALLA DETECTADA." -ForegroundColor Red
            Write-Host "Error exacto: $($entry.lastErrorMessage)" -ForegroundColor Red
            Write-Host "Hora del error: $ultimoError" -ForegroundColor Red
            if ($ultimoExito) {
                Write-Host "Ultimo exito conocido: $ultimoExito" -ForegroundColor Gray
            } else {
                Write-Host "Nunca tuvo un ciclo exitoso desde que arranco el proceso." -ForegroundColor Gray
            }
        } elseif ($ultimoExito) {
            Write-Host "OK. Ultimo exito: $ultimoExito ($($entry.lastSuccessDetail))" -ForegroundColor Green
        } else {
            Write-Host "SIN DATOS: todavia no se registro ni un exito ni un error." -ForegroundColor Yellow
        }
    }

    Write-Host ""
    if ($huboProblemas) {
        Write-Host "RESULTADO: se detectaron fallas -- revisar los mensajes de error de arriba (esos son los que hay que corregir)." -ForegroundColor Red
    } else {
        Write-Host "RESULTADO: VENTAS, INVENTARIO y TRANSFERENCIAS estan sincronizando sin errores detectados." -ForegroundColor Green
    }
}

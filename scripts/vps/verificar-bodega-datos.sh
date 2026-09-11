#!/usr/bin/env bash
# Chequeo de salud: compara, para cada tienda, cuantas ventas de HOY llegaron
# al VPS (mirror-sync) contra cuantas llegaron a bodega_datos, y revisa que
# ningun cursor de bodega-export haya quedado "envenenado" con una fecha del
# futuro (la causa exacta del incidente del 10-11/9/2026).
#
# 100% de solo lectura: no escribe, no borra, no reinicia nada. Seguro para
# correr las veces que haga falta.
#
# Uso (parado en el VPS, usuario deploy):
#   bash /home/deploy/apps/rockyMaxx/scripts/vps/verificar-bodega-datos.sh
#
# Uso desde Windows (sin entrar a la terminal del VPS a mano):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\verificar-sync-bodega-datos.ps1
#
# Codigo de salida: 0 si todo esta bien, 1 si encontro algo para revisar.

set -euo pipefail

API_DIR="/home/deploy/apps/rockyMaxx/apps/api"
BODEGA_DIR="/home/deploy/apps/rockyMaxxBodega/apps/bodega-api"
HOY=$(date +%Y-%m-%d)
HOY_INICIO="${HOY} 00:00:00-04"
HOY_FIN_DIA=$(date -d "${HOY} +1 day" +%Y-%m-%d)
HOY_FIN="${HOY_FIN_DIA} 00:00:00-04"
TOLERANCIA=5

TIENDAS=(tienda001 tienda002 tienda003 tienda004 tienda005 tienda006)

# --- helpers ---------------------------------------------------------------

leer_conexion() {
  # Imprime "host|port|db|user|pass" a partir de un archivo .env con DATABASE_URL.
  local envfile="$1"
  local url
  url=$(grep -m1 '^DATABASE_URL=' "$envfile" | sed -E 's/^DATABASE_URL="?//; s/"$//')
  local proto_stripped="${url#postgresql://}"
  local userpass="${proto_stripped%%@*}"
  local rest="${proto_stripped#*@}"
  local user="${userpass%%:*}"
  local pass="${userpass#*:}"
  local hostport_db="${rest%%\?*}"
  local hostport="${hostport_db%%/*}"
  local db="${hostport_db#*/}"
  local host="${hostport%%:*}"
  local port="${hostport##*:}"
  echo "${host}|${port}|${db}|${user}|${pass}"
}

psql_de() {
  # psql_de <envfile> <sql>
  local envfile="$1"; local sql="$2"
  IFS='|' read -r host port db user pass <<< "$(leer_conexion "$envfile")"
  PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db" -t -A -F'|' -c "$sql"
}

hubo_problemas=0

echo "=================================================================="
echo " Chequeo de sync bodega_datos -- ${HOY}"
echo "=================================================================="
echo

# --- 1. contar aplicadas en mirror-sync por tienda -------------------------

declare -A APLICADAS
declare -A ERRORES_MS

for t in "${TIENDAS[@]}"; do
  envfile="${API_DIR}/.env.vps.${t}"
  if [ ! -f "$envfile" ]; then
    echo "AVISO: no existe $envfile, se salta $t"
    continue
  fi
  fila=$(psql_de "$envfile" "
    select
      count(*) filter (where \"Status\"='APPLIED'),
      count(*) filter (where \"Status\" not in ('APPLIED'))
    from dbo.\"MIRROR_SYNC_INBOX\"
    where \"EntityType\"='VENTAS' and \"ReceivedAt\" >= '${HOY_INICIO}' and \"ReceivedAt\" < '${HOY_FIN}';
  ")
  APLICADAS[$t]=$(echo "$fila" | cut -d'|' -f1)
  ERRORES_MS[$t]=$(echo "$fila" | cut -d'|' -f2)
done

# --- 2. contar distinct pk_origen en bodega_datos por tienda ----------------

BODEGA_ENV="${BODEGA_DIR}/.env"
declare -A EN_BODEGA
while IFS='|' read -r codigo cantidad; do
  [ -z "$codigo" ] && continue
  EN_BODEGA[$codigo]="$cantidad"
done < <(psql_de "$BODEGA_ENV" "
  select codigo_tienda_legacy, count(distinct pk_origen)
  from public.\"HECH_VENTAS_HIST\"
  where tabla_origen='VENTAS' and es_actual = true
    and (payload_json->>'Fecha')::timestamp >= '${HOY} 00:00:00' and (payload_json->>'Fecha')::timestamp < '${HOY_FIN_DIA} 00:00:00'
  group by codigo_tienda_legacy;
")

errores_etl=$(psql_de "$BODEGA_ENV" "select count(*) from public.\"ETL_SYNC_ERRORS\" where created_at >= '${HOY_INICIO}';")

# --- 3. reportar tabla comparativa ------------------------------------------

printf "%-10s %14s %14s %10s %s\n" "TIENDA" "EN_VPS" "EN_BODEGA" "DIF" "ESTADO"
for t in "${TIENDAS[@]}"; do
  codigo="${t#tienda}"
  vps="${APLICADAS[$t]:-0}"
  bodega="${EN_BODEGA[$codigo]:-0}"
  dif=$((vps - bodega))
  estado="OK"
  # Solo alarma si a bodega_datos le FALTAN ventas que si llegaron al VPS
  # (dif positivo y mayor a la tolerancia). Que bodega_datos tenga de MAS
  # (dif negativo) no es un problema -- pasa si se corrio este chequeo justo
  # entre que se leyeron los dos lados, o durante una recuperacion de
  # backlog, y no indica perdida de datos.
  if [ "$dif" -gt "$TOLERANCIA" ]; then
    estado="REVISAR (faltan ${dif} en bodega_datos)"
    hubo_problemas=1
  fi
  if [ "${ERRORES_MS[$t]:-0}" -gt 0 ]; then
    estado="${estado} + ${ERRORES_MS[$t]} errores en mirror-sync"
    hubo_problemas=1
  fi
  printf "%-10s %14s %14s %10s %s\n" "$t" "$vps" "$bodega" "$dif" "$estado"
done

echo
echo "Errores ETL en bodega_datos hoy: ${errores_etl}"
if [ "$errores_etl" -gt 0 ]; then
  hubo_problemas=1
fi

# --- 4. chequeo especifico: cursor envenenado (fecha del futuro) -----------

echo
echo "-- Cursores de bodega-export (VENTAS/MOVVENTAS/INVENTARIO): ninguno debe estar en el futuro --"
ahora_epoch=$(date +%s)
for t in "${TIENDAS[@]}"; do
  envfile="${API_DIR}/.env.vps.${t}"
  [ -f "$envfile" ] || continue
  IFS='|' read -r host port db user pass <<< "$(leer_conexion "$envfile")"
  while IFS='|' read -r clave valor; do
    [ -z "$clave" ] && continue
    fecha_cursor=$(echo "$valor" | grep -oE '"fecha":"[^"]*"' | sed -E 's/"fecha":"([^"]*)"/\1/')
    [ -z "$fecha_cursor" ] && continue
    cursor_epoch=$(date -d "$fecha_cursor" +%s 2>/dev/null || echo 0)
    if [ "$cursor_epoch" -gt "$ahora_epoch" ]; then
      diff_min=$(( (cursor_epoch - ahora_epoch) / 60 ))
      echo "  ENVENENADO: $t / $clave esta ${diff_min} minutos en el futuro ($fecha_cursor)"
      hubo_problemas=1
    fi
  done < <(PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db" -t -A -F'|' -c "select \"ClaveCursor\", \"ValorCursor\" from dbo.\"BODEGA_EXPORT_CURSOR\" where \"ClaveCursor\" in ('VENTAS','MOVVENTAS','INVENTARIO');")
done
if [ "$hubo_problemas" -eq 0 ] || true; then
  : # el detalle de "ningun cursor envenenado" ya se imprime arriba si aplica
fi

echo
echo "=================================================================="
if [ "$hubo_problemas" -eq 0 ]; then
  echo " TODO OK -- sin huecos, sin errores, sin cursores envenenados."
else
  echo " HAY ALGO PARA REVISAR -- ver el detalle arriba."
fi
echo "=================================================================="

exit "$hubo_problemas"

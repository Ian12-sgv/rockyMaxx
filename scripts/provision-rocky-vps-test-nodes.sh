#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-/home/deploy/apps/rockyMaxx}"
API_DIR="${API_DIR:-$ROOT_DIR/apps/api}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_GROUP="${DEPLOY_GROUP:-deploy}"
TEMPLATE_ENV_FILE="${TEMPLATE_ENV_FILE:-$API_DIR/.env.vps.tienda001}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/rocky-maxx}"

SOURCE_TIENDA_DB="${SOURCE_TIENDA_DB:-rocky_tienda_001_vps}"
SOURCE_BODEGA_DB="${SOURCE_BODEGA_DB:-rocky_sync_central}"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo bash "$0" "$@"
fi

require_file() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    echo "No existe el archivo requerido: $file_path" >&2
    exit 1
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "No se encontro el comando requerido: $command_name" >&2
    exit 1
  fi
}

require_file "$TEMPLATE_ENV_FILE"
require_file "$NGINX_CONF"
require_command psql
require_command pg_dump
require_command pg_restore
require_command python3
require_command systemctl
require_command nginx
require_command curl

extract_database_user() {
  sed -n 's/^DATABASE_URL="postgresql:\/\/\([^:"]*\):\([^@"]*\)@.*$/\1/p' "$TEMPLATE_ENV_FILE" | head -n 1
}

extract_database_password() {
  sed -n 's/^DATABASE_URL="postgresql:\/\/\([^:"]*\):\([^@"]*\)@.*$/\2/p' "$TEMPLATE_ENV_FILE" | head -n 1
}

DATABASE_USER="$(extract_database_user)"
DATABASE_PASSWORD="$(extract_database_password)"

if [[ -z "$DATABASE_USER" || -z "$DATABASE_PASSWORD" ]]; then
  echo "No se pudo leer el usuario o la clave de PostgreSQL desde $TEMPLATE_ENV_FILE" >&2
  exit 1
fi

generate_secret() {
  python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
}

database_exists() {
  local database_name="$1"
  sudo -u postgres psql -tAc "select 1 from pg_database where datname='${database_name}'" | grep -q '^1$'
}

port_is_busy() {
  local port="$1"
  ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .
}

create_database_from_source() {
  local source_db="$1"
  local target_db="$2"
  local dump_file="$3"

  if database_exists "$target_db"; then
    echo "Base ya existente: $target_db"
    return
  fi

  echo "Creando base $target_db desde $source_db"
  sudo -u postgres createdb -O "$DATABASE_USER" "$target_db"
  sudo -u postgres pg_restore --no-owner --role="$DATABASE_USER" --clean --if-exists -d "$target_db" "$dump_file"
}

write_env_file() {
  local env_path="$1"
  local database_name="$2"
  local api_port="$3"
  local jwt_secret="$4"
  local pepper_secret="$5"

  cat >"$env_path" <<EOF
DATABASE_URL="postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@localhost:5432/${database_name}?schema=dbo"
API_PORT=${api_port}
API_HOST=127.0.0.1
JWT_SECRET="${jwt_secret}"
JWT_EXPIRES_IN="12h"
AUTH_PASSWORD_PEPPER="${pepper_secret}"
AUTH_BOOTSTRAP_ADMIN_ENABLED=false
AUTH_BOOTSTRAP_ADMIN_USERNAME="admin"
AUTH_BOOTSTRAP_ADMIN_NAME="admin"
AUTH_BOOTSTRAP_ADMIN_PASSWORD="123456"
AUTH_BOOTSTRAP_ADMIN_GROUP="admin"
AUTH_BOOTSTRAP_SYSTEM_ENABLED=true
AUTH_BOOTSTRAP_SYSTEM_USERNAME="sistema"
AUTH_BOOTSTRAP_SYSTEM_NAME="sistema"
AUTH_BOOTSTRAP_SYSTEM_PASSWORD="456789"
AUTH_BOOTSTRAP_SYSTEM_GROUP="sistema"
AUTH_BOOTSTRAP_SYSTEM_GROUP_NAME="Sistema"
TRANSFER_SYNC_AUTO_RETRY_ENABLED=true
TRANSFER_SYNC_AUTO_RETRY_INTERVAL_MS=30000
TRANSFER_SYNC_AUTO_RETRY_STARTUP_DELAY_MS=5000
TRANSFER_SYNC_AUTO_RETRY_LIMIT=25
MIRROR_SYNC_ENABLED=false
MIRROR_SYNC_REMOTE_API_URL=""
MIRROR_SYNC_USERNAME="sistema"
MIRROR_SYNC_PASSWORD="456789"
MIRROR_SYNC_AUTO_RETRY_INTERVAL_MS=30000
MIRROR_SYNC_AUTO_RETRY_STARTUP_DELAY_MS=5000
MIRROR_SYNC_AUTO_RETRY_LIMIT=200
MIRROR_SYNC_AUTO_RETRY_MAX_BATCHES=25
EOF

  chown "$DEPLOY_USER:$DEPLOY_GROUP" "$env_path"
  chmod 600 "$env_path"
}

write_service_file() {
  local service_path="$1"
  local description="$2"
  local env_path="$3"

  cat >"$service_path" <<EOF
[Unit]
Description=${description}
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${DEPLOY_USER}
Group=${DEPLOY_GROUP}
WorkingDirectory=${API_DIR}
EnvironmentFile=${env_path}
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
}

ensure_nginx_route() {
  local route_path="$1"
  local port="$2"

  if grep -Fq "location ${route_path} {" "$NGINX_CONF"; then
    echo "Ruta Nginx ya existente: ${route_path}"
    return
  fi

  python3 - "$NGINX_CONF" "$route_path" "$port" <<'PY'
from pathlib import Path
import sys

conf_path = Path(sys.argv[1])
route_path = sys.argv[2]
port = sys.argv[3]
content = conf_path.read_text(encoding="utf-8")
marker = "    location / {\n"
block = (
    f"    location {route_path} {{\n"
    f"        proxy_pass http://127.0.0.1:{port}/;\n"
    f"        proxy_http_version 1.1;\n"
    f"        proxy_set_header Host $host;\n"
    f"        proxy_set_header X-Real-IP $remote_addr;\n"
    f"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
    f"        proxy_set_header X-Forwarded-Proto $scheme;\n"
    f"    }}\n\n"
)

if marker not in content:
    raise SystemExit("No se encontro el bloque location / en la configuracion de Nginx.")

updated = content.replace(marker, block + marker, 1)
conf_path.write_text(updated, encoding="utf-8")
PY
}

assert_route_health() {
  local public_url="$1"
  local local_port="$2"

  curl -fsS "http://127.0.0.1:${local_port}/api/health" >/dev/null
  curl -fsS "${public_url}/api/health" >/dev/null
}

echo "Preparando dumps base"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TIENDA_DUMP="$TMP_DIR/tienda.dump"
BODEGA_DUMP="$TMP_DIR/bodega.dump"

sudo -u postgres pg_dump -Fc -d "$SOURCE_TIENDA_DB" -f "$TIENDA_DUMP"
sudo -u postgres pg_dump -Fc -d "$SOURCE_BODEGA_DB" -f "$BODEGA_DUMP"

declare -a NODE_SPECS=(
  "prueba-sistemas-tienda|Prueba Sistemas - Tienda|rocky_prueba_sistemas_tienda|3008|/prueba-sistemas-tienda/|$SOURCE_TIENDA_DB|$TIENDA_DUMP"
  "prueba-sistemas-bodega|Prueba Sistemas - Bodega|rocky_prueba_sistemas_bodega|3009|/prueba-sistemas-bodega/|$SOURCE_BODEGA_DB|$BODEGA_DUMP"
  "prueba-analista-tienda|Prueba Analista - Tienda|rocky_prueba_analista_tienda|3010|/prueba-analista-tienda/|$SOURCE_TIENDA_DB|$TIENDA_DUMP"
  "prueba-analista-bodega|Prueba Analista - Bodega|rocky_prueba_analista_bodega|3011|/prueba-analista-bodega/|$SOURCE_BODEGA_DB|$BODEGA_DUMP"
)

for spec in "${NODE_SPECS[@]}"; do
  IFS='|' read -r node_id node_label database_name api_port route_path source_db dump_file <<<"$spec"

  if port_is_busy "$api_port"; then
    echo "El puerto ${api_port} ya esta ocupado. Ajusta el script antes de continuar." >&2
    exit 1
  fi

  create_database_from_source "$source_db" "$database_name" "$dump_file"

  env_file="${API_DIR}/.env.vps.${node_id}"
  service_file="/etc/systemd/system/rocky-maxx-api-${node_id}.service"

  write_env_file "$env_file" "$database_name" "$api_port" "$(generate_secret)" "$(generate_secret)"
  write_service_file "$service_file" "Rocky Maxx API ${node_label}" "$env_file"
  ensure_nginx_route "$route_path" "$api_port"
done

echo "Compilando API"
sudo -u "$DEPLOY_USER" bash -lc "cd '$ROOT_DIR' && npm run prisma:generate && npm run build:api"

echo "Recargando systemd y Nginx"
systemctl daemon-reload

for spec in "${NODE_SPECS[@]}"; do
  IFS='|' read -r node_id _node_label _database_name api_port route_path _source_db _dump_file <<<"$spec"
  systemctl enable "rocky-maxx-api-${node_id}.service"
  systemctl restart "rocky-maxx-api-${node_id}.service"
  assert_route_health "http://68.183.105.135${route_path%/}" "$api_port"
done

nginx -t
systemctl restart nginx

for spec in "${NODE_SPECS[@]}"; do
  IFS='|' read -r _node_id node_label _database_name api_port route_path _source_db _dump_file <<<"$spec"
  assert_route_health "http://68.183.105.135${route_path%/}" "$api_port"
  echo "OK ${node_label}: http://68.183.105.135${route_path%/}"
done


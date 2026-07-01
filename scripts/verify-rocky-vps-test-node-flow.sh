#!/usr/bin/env bash
set -euo pipefail

BASES=(
  "http://68.183.105.135/prueba-sistemas-tienda"
  "http://68.183.105.135/prueba-sistemas-bodega"
  "http://68.183.105.135/prueba-analista-tienda"
  "http://68.183.105.135/prueba-analista-bodega"
)

for base in "${BASES[@]}"; do
  token="$(
    curl -fsS \
      -H "Content-Type: application/json" \
      -d '{"usuario":"sistema","password":"456789"}' \
      "$base/api/auth/login" \
      | python3 -c 'import sys, json; print(json.load(sys.stdin)["accessToken"])'
  )"

  code="$(
    curl -fsS -o /dev/null -w "%{http_code}" \
      -H "Authorization: Bearer ${token}" \
      "$base/api/maintenance/database-dump"
  )"

  echo "${base} dump=${code}"
done

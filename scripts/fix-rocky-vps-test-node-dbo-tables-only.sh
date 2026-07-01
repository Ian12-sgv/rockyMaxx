#!/usr/bin/env bash
set -euo pipefail

DATABASES=(
  "rocky_prueba_sistemas_tienda"
  "rocky_prueba_sistemas_bodega"
  "rocky_prueba_analista_tienda"
  "rocky_prueba_analista_bodega"
)

SERVICES=(
  "rocky-maxx-api-prueba-sistemas-tienda"
  "rocky-maxx-api-prueba-sistemas-bodega"
  "rocky-maxx-api-prueba-analista-tienda"
  "rocky-maxx-api-prueba-analista-bodega"
)

LOCAL_URLS=(
  "http://127.0.0.1:3008/api/health"
  "http://127.0.0.1:3009/api/health"
  "http://127.0.0.1:3010/api/health"
  "http://127.0.0.1:3011/api/health"
)

PUBLIC_URLS=(
  "http://68.183.105.135/prueba-sistemas-tienda/api/health"
  "http://68.183.105.135/prueba-sistemas-bodega/api/health"
  "http://68.183.105.135/prueba-analista-tienda/api/health"
  "http://68.183.105.135/prueba-analista-bodega/api/health"
)

for db in "${DATABASES[@]}"; do
  sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
ALTER SCHEMA dbo OWNER TO rocky;
GRANT ALL ON SCHEMA dbo TO rocky;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.relkind, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'dbo'
      AND r.rolname = 'postgres'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    IF rec.relkind IN ('r', 'p') THEN
      EXECUTE format('ALTER TABLE dbo.%I OWNER TO rocky', rec.relname);
    ELSIF rec.relkind IN ('v', 'm') THEN
      EXECUTE format('ALTER VIEW dbo.%I OWNER TO rocky', rec.relname);
    ELSIF rec.relkind = 'f' THEN
      EXECUTE format('ALTER FOREIGN TABLE dbo.%I OWNER TO rocky', rec.relname);
    END IF;
  END LOOP;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA dbo TO rocky;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA dbo TO rocky;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA dbo TO rocky;
ALTER DEFAULT PRIVILEGES FOR ROLE rocky IN SCHEMA dbo GRANT ALL ON TABLES TO rocky;
ALTER DEFAULT PRIVILEGES FOR ROLE rocky IN SCHEMA dbo GRANT ALL ON SEQUENCES TO rocky;
ALTER DEFAULT PRIVILEGES FOR ROLE rocky IN SCHEMA dbo GRANT ALL ON FUNCTIONS TO rocky;
SQL
done

for service in "${SERVICES[@]}"; do
  systemctl restart "$service"
done

sleep 8

for url in "${LOCAL_URLS[@]}"; do
  curl -fsS "$url" >/dev/null
done

for url in "${PUBLIC_URLS[@]}"; do
  curl -fsS "$url" >/dev/null
done

echo "OK"

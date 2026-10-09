---
name: rocky-maxx-add-node
description: Agregar una tienda o bodega nueva a Rocky Maxx (local + VPS), siguiendo la receta validada con todos los gotchas reales ya encontrados. Usar cuando el usuario pida crear/agregar un nodo nuevo (tienda o bodega), emparejarlo con otros nodos para transferencias/cambio de precio, o diagnosticar por que un nodo nuevo no aparece en los selectores del sistema.
---

# Rocky Maxx: agregar tienda o bodega nueva

Receta operativa, no solo descriptiva. Nace de crear Bodega Rockymaxx (B003) en
2026-09-10/11 y de diagnosticar por que Bodega 002/003 no aparecian correctamente
en otras PCs despues. Seguir las fases en orden; no saltarse la verificacion de cada una.

## 0. Antes de empezar

Preguntar al usuario (no asumir) si no esta claro:

- Codigo de sucursal (ej. `007`, `B004`) y nombre para mostrar.
- Tipo: `TIENDA` o `BODEGA`.
- Base de datos: fresca/vacia, o clonada de un dump existente.
- Con que otras tiendas/bodegas va a hacer transferencias o recibir Cambio de Precio
  (determina a quien hay que emparejar en la fase 6).

Reglas que siempre aplican durante todo este proceso:

- **Cualquier comando privilegiado en el VPS** (`sudo`, `systemctl`, `nginx`, `createdb`,
  escrituras por `psql`, editar configs) necesita mostrar el plan exacto y esperar la
  palabra literal **APROBADO** antes de ejecutar. Nunca pasar el password de `sudo` por
  stdin/pipe/variable, ni aunque el usuario lo escriba en el chat — ver
  `feedback_vps_privileged_ops_protocol` en memoria.
- **No tocar bases de tiendas/bodegas existentes** mientras se hace esto — ver
  `feedback_bodega_datos_db_safety` en memoria (aplica por analogia: nunca destructivo).
- Claude Code bloquea automaticamente cualquier intento de autenticarse por su cuenta
  contra la API (login con usuario/password conocido) o de extraer un password desde un
  archivo de config ("Credential Exploration"/"Credential Materialization"), aunque el
  dato ya sea publico en la documentacion del proyecto. **No intentar rodear esto.**
  Para cualquier paso que requiera login+POST contra la API (fase 6), armar el comando
  completo y pedirle al usuario que lo corra el mismo en su propia terminal.

## 1. Elegir identificadores y puertos

Seguir el patron ya usado (ver `contecto para otro chat/ACCESO_VPS_Y_GUIA_DE_BASES.md`
para el estado actual exacto de que puertos/DBs ya existen):

- `NodeId`: `TIENDA00X` o `BODEGA00X` (mayusculas, sin espacios).
- `SucursalCodigo`: `00X` para tiendas, `B00X` para bodegas.
- DB local: `rocky_tienda_00X` / `rocky_bodega_00X`.
- DB VPS: `rocky_tienda_00X_vps` / `rocky_bodega_00X_vps`.
- Puerto interno: siguiente libre en la secuencia (revisar servicios `systemd` actuales
  en el VPS con `systemctl list-units --type=service --all | grep rocky-maxx-api`).
- Ruta Nginx: `/tienda00X/` o `/bodega00X/`.

## 2. Base de datos: fresca vs. clonada

**Si se clona de un dump existente** (restaurar + `ALTER SCHEMA dbo OWNER TO rocky` +
`GRANT ALL`): el patron de `scripts/fix-rocky-vps-test-node-ownership.sh` sirve tal cual
(`REASSIGN OWNED BY postgres TO rocky` funciona en una base que ya tenia dueno real).

**Si es una base genuinamente nueva/vacia — camino recomendado (validado con la tienda 007, 2026-10-08):**

1. Tú pegas `sudo -u postgres createdb -O rocky rocky_<nodo>_vps` (el rol `rocky` no tiene CREATEDB).
2. Claude carga los 4 `.sql` **conectado como `rocky`** usando la `DATABASE_URL` de un
   `.env.vps.*` existente, con la base cambiada (ninguno de los SQL necesita superusuario):
   `psql "$URL_rocky/rocky_<nodo>_vps" -v ON_ERROR_STOP=1 -q -f ../../database/postgres/<archivo>.sql`.
   Todo queda con dueño `rocky` y **no hace falta el paso de reasignar ownership de abajo**.
   Resultado esperado: 85 tablas, 13 vistas, 65 rutinas en `dbo` (la API agrega ~17 tablas de
   sync/outbox al arrancar).

**Camino viejo (solo si el esquema ya se cargó como `postgres`)**, cargada desde cero con los `.sql` legacy:
`REASSIGN OWNED BY postgres` **va a fallar** con
`cannot reassign ownership of objects owned by role postgres because they are required
by the database system` (el rol `postgres` posee objetos pineados del cluster, ej.
`plpgsql`). Usar en su lugar (ver `reference_rocky_maxx_new_node_bootstrap_recipe` en
memoria para el porque de cada gotcha):

1. Cargar el esquema en este orden exacto: `database/postgres/legacy_mirror.sql` →
   `legacy_programmable_compat.sql` → `legacy_programmable_remaining.sql` →
   `project_guards.sql` (orden documentado en `docs/database/legacy-programmable-compat.md`).
   Si se corre como `sudo -u postgres psql -f archivo`, todo queda owned por `postgres`
   — eso se corrige en el paso siguiente.

2. Reasignar objeto por objeto (NO `REASSIGN OWNED BY postgres`), en un solo `DO $$` por
   bloque logico para poder reintentar si algo falla (un error dentro de un `DO $$` revierte
   TODO ese bloque, incluyendo lo ya procesado):

   ```sql
   DO $$
   DECLARE r RECORD;
   BEGIN
     -- Tablas
     FOR r IN SELECT c.relname FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'dbo' AND c.relkind = 'r'
     LOOP
       EXECUTE format('ALTER TABLE dbo.%I OWNER TO rocky', r.relname);
     END LOOP;

     -- Secuencias NO ligadas a una columna identity/serial (las ligadas cambian de
     -- dueno solas al hacer ALTER TABLE de su tabla; intentar alterarlas directo falla
     -- con "is linked to table X")
     FOR r IN SELECT c.relname FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'dbo' AND c.relkind = 'S'
                AND NOT EXISTS (
                  SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i')
                )
     LOOP
       EXECUTE format('ALTER SEQUENCE dbo.%I OWNER TO rocky', r.relname);
     END LOOP;

     -- Funciones Y procedimientos juntos: usar ALTER ROUTINE, no ALTER FUNCTION
     -- (ALTER FUNCTION rechaza los PROCEDURE con "is not a function" y aborta el bloque)
     FOR r IN SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'dbo'
     LOOP
       EXECUTE format('ALTER ROUTINE %s OWNER TO rocky', r.signature);
     END LOOP;
   END $$;

   ALTER SCHEMA dbo OWNER TO rocky;
   GRANT ALL ON SCHEMA dbo TO rocky;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA dbo TO rocky;
   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA dbo TO rocky;
   ALTER DEFAULT PRIVILEGES FOR ROLE rocky IN SCHEMA dbo GRANT ALL ON TABLES TO rocky;
   ALTER DEFAULT PRIVILEGES FOR ROLE rocky IN SCHEMA dbo GRANT ALL ON SEQUENCES TO rocky;
   ```

   Esta forma exacta del `DO $$` no esta probada letra por letra (se reconstruyo desde la
   descripcion del gotcha, no desde un script guardado) — correrla primero y verificar
   con el diagnostico de abajo antes de asumir que funciono.

3. **Diagnostico rapido** (correr esto si algo huele mal, o despues de cualquier intento):

   ```sql
   SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='dbo' GROUP BY tableowner;
   ```

   Si sigue devolviendo solo `postgres`, el bloque aborto en algun punto sin verse el
   error — revisar y reintentar, no asumir que ya quedo bien.

Esto es un comando privilegiado (`sudo -u postgres psql`) — mostrar el plan y esperar
**APROBADO** antes de correrlo.

## 3. Verificacion de arranque

Boot limpio debe mostrar en el log: `Nest application successfully started`,
`Usuario caja inicial verificado`, `Usuario sistema inicial verificado`, y `/api/health`
debe responder `200` con el nombre de base correcto.

Si en una base 100% vacia aparece `BadRequestException: Grupo no valido: ADMI`:
eso era un bug real de `ensureDefaultAdmin()` en `apps/api/src/users/users.service.ts`
(no creaba el grupo `ADMI` como si hacen `ensureSystemOperator`/`ensureCashierOperator`).
Deberia estar corregido desde el commit `573b2d4` — verificar que el codigo desplegado
lo incluya (`git log -1 --oneline` en el VPS) si el error reaparece.

**Env de la gemela VPS en una base vacía:** copiar `.env.vps.tienda006` cambiando base, puerto,
JWT/pepper y `BODEGA_INGEST_URL`, y además:

- `AUTH_BOOTSTRAP_ADMIN_ENABLED=true` y el mismo `AUTH_BOOTSTRAP_ADMIN_PASSWORD` que
  `.env.vps.bodega003`. Las gemelas de tiendas tienen `false` porque vienen de un dump que ya
  traía `admin`; en una base vacía sin `admin`, transferencias, devoluciones y Cambio de Precio de
  la tienda local fallan con "Usuario o clave inválidos" (entran con `TRANSFER_SYNC_USERNAME=admin`).
  Comparar claves por hash (`sha256sum | cut -c1-12`), nunca mostrarlas.
- `BODEGA_SYNC_ENABLED=false` (bodega-export ya se desactiva solo en bases `*_vps`; así queda explícito).

**Env local:** copiar `.env.tienda006` cambiando solo `DATABASE_URL`, `API_PORT`, `JWT_SECRET`,
`AUTH_PASSWORD_PEPPER`, `MIRROR_SYNC_REMOTE_API_URL` y `BODEGA_INGEST_URL`.

**Gotcha de arranque desatendido:** los `herramientas/scripts/arrancar-api-*.ps1` usan
`$ErrorActionPreference="Stop"`; si se redirige su salida (`*>`), PowerShell 5.1 corta node en la
primera línea que escribe a stderr (p. ej. un ERROR de sync). Para pruebas, lanzar node con
`Start-Process ... -RedirectStandardError`. Quitar `ELECTRON_RUN_AS_NODE` antes.

## 4. Servicio systemd + Nginx (VPS)

Puertos internos del VPS ocupados al 2026-10-08: 3000–3013 (3008–3011 son nodos de prueba,
3012 = B003, 3013 = tienda 007) y 3100 = bodega-api. Verificar con `ss -ltn`.

Para no editar en caliente: Claude prepara sin sudo el `.service` y el Nginx completo en
`/home/deploy/tmp/<nodo>/` (generados a partir de los de la 006 con `sed`/`awk`), muestra el
`diff` contra los activos, y tú solo pegas `sudo cp` + `daemon-reload` + `enable --now`, y para
Nginx: respaldo, `sudo cp`, `sudo nginx -t` y **`reload`** (no `restart`).

Mismo patron que los nodos existentes — ver `contecto para otro chat/ACCESO_VPS_Y_GUIA_DE_BASES.md`,
seccion "Pasos para agregar una nueva tienda o bodega en el VPS": crear
`.env.vps.<nodo>`, el `.service` de systemd, la ruta de Nginx, luego:

```bash
sudo systemctl daemon-reload
sudo systemctl enable rocky-maxx-api-<nodo>
sudo systemctl restart rocky-maxx-api-<nodo>
sudo nginx -t
sudo systemctl restart nginx
curl -s http://127.0.0.1:<puerto>/api/health
curl -s http://127.0.0.1/<nodo>/api/health
```

Todo esto es privilegiado — plan + **APROBADO** antes de cada bloque.

## 5. Dar de alta la Sucursal en el nodo mismo

Vía API (no SQL crudo), en la base del nodo nuevo: crear la fila en `Sucursales` con su
propio codigo/nombre.

## 6. Registrar el nodo para que OTROS lo vean (el paso que mas se olvida)

`SYNC_NODES` **no se sincroniza solo entre nodos** — cada base tiene su propia copia.
Que el nodo nuevo exista no significa que Central (ni ninguna tienda/bodega con la que
vaya a transferir) sepa que existe. Hay que registrarlo explicitamente en cada lado:

**En el Central del VPS** (`rocky_sync_central` — de aqui sale el dump que usa el
Instalador para PCs nuevas, asi que esto es lo mas importante de todo):

```bash
# Correr esto EN el VPS (deploy@rocky-maxx-sync-prod-01), o en cualquier PC con internet
# apuntando a http://68.183.105.135. Esto NO es privilegiado a nivel de sistema (no usa
# sudo) pero SI escribe en una base de produccion -- avisar que se va a correr, no hace
# falta "APROBADO" literal pero si confirmacion.
read -r -s -p "Clave de sistema: " PASS; echo
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d "{\"usuario\":\"sistema\",\"password\":\"$PASS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -s -X POST http://127.0.0.1:3000/api/transfers/sync/nodes -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"nodeId":"<NODEID>","sucursalCodigo":"<CODIGO>","nombre":"<Nombre>","tipo":"<TIENDA|BODEGA>","apiUrl":"http://68.183.105.135/<nodo>"}'
```

**IMPORTANTE:** Claude no puede correr este login el mismo (bloqueado por
"Credential Exploration"). Armar el comando exacto y pedirle al usuario que lo pegue en
su propia terminal (o en la sesion SSH del VPS). Verificar antes con un `GET` de solo
lectura si el nodo ya existe, para no asumir.

**En cada tienda/bodega con la que vaya a transferir o recibir Cambio de Precio**
(preguntar al usuario con cuales, no asumir todas): mismo POST de arriba pero contra
`http://68.183.105.135/<esa-tienda-o-bodega>` en vez de `127.0.0.1:3000`, y tambien dar
de alta la Sucursal del nodo nuevo en el catalogo `Sucursales` de esa tienda/bodega si
hace falta.

**Lado del nodo nuevo:** al primer arranque, la tienda nueva crea sola en su `SYNC_NODES` el
nodo `ORIGEN` (local → `http://68.183.105.135`, gemela → `http://localhost:3000`) y el suyo
propio. Las sucursales de otros nodos se crean solas al llegar una transferencia
(`ensureLocations`). Normalmente **solo falta el lado de Central**: `rocky_sync_central` (VPS) y
`rocky_maxx` (PC de oficina). Patrón validado: un `.mjs` que valida que la base sea Central, hace
login con `sistema`, crea la sucursal y el nodo solo si faltan, y verifica; el usuario lo corre
con un wrapper que pide la clave oculta (`read -s` / `Read-Host -AsSecureString`).

**bodega_datos:** `POST /bodega/ingest/:codigo` exige la fila en `DIM_TIENDAS`
(`requireActiveByCodigo`). Insertarla con un `INSERT ... ON CONFLICT (codigo_legacy) DO NOTHING`
(con `gen_random_uuid()`, `now()`). **No correr `prisma db seed`**: hace upsert de nombres y pisa
los de producción ("RockyMaxxCentro", "Moda shop"...), y el filtro Grupo B del panel depende de
que el nombre contenga "rocky". La conexión está en
`/home/deploy/apps/rockyMaxxBodega/apps/bodega-api/.env` (checkout aparte del de `apps/api`).

## 7. Actualizar el codigo para que esto no se vuelva a perder

Ediciones de codigo, directas (no privilegiadas, se hacen con Edit normal):

0. **Facturación** (`apps/api/src/facturacion/facturacion.service.ts`): agregar el código en
   `FACTURACION_STORE_TAX_ID_BY_CODE` y `FACTURACION_STORE_ADDRESS_BY_CODE` (pedir RIF y
   dirección al usuario). Llega a la PC real solo con un build nuevo de desktop-service.
0. **`apps/bodega-api/prisma/seed.ts`**: agregar la fila con el nombre como está en producción
   (solo documental; ver arriba por qué no se corre).
0. **Panel** (`CODIGOS_TIENDA_ACTIVOS_PANEL` en `apps/bodega-api/src/validaciones/validaciones.service.ts`):
   agregar el código **solo** cuando la PC real ya esté exportando (verificar `ETL_SYNC_RUNS`).
0. Script `herramientas/scripts/arrancar-api-<nodo>.ps1` (copiar el de bodega003).

1. **`apps/api/src/transfers/transfers.service.ts`**, constante `KNOWN_SYNC_NODES`
   (buscar ese nombre): agregar una entrada para el nodo nuevo. Esto hace que **cualquier
   instancia Central que arranque** (incluida una PC de oficina vieja que nunca se
   actualizo) se auto-repare sola y registre el nodo si le faltaba — ver
   `project_rocky_maxx_bodega_rockymaxx_node`-style fix del 2026-10-06/07 para el porque.

2. **`apps/desktop-installer/main.js`**, arreglo `REMOTE_NODES` (buscar ese nombre):
   agregar una entrada igual, para que el selector "Base remota" del Instalador pueda
   restaurar/clonar este nodo nuevo en una PC futura.

Despues de editar, correr `npm run typecheck:api` para confirmar que no se rompio nada.

## 8. Rebuild y distribucion (si aplica)

Si el usuario quiere que una PC nueva/existente ya traiga esto empacado:

- `apps/desktop-service/package.json`: subir `version`, luego `npm run service:dist`
  (output en `dist/desktop-service/Rocky Maxx Servicio Local Setup <version>.exe`).
- `apps/desktop/package.json`: subir `version`, luego `npm run desktop:dist` si tambien
  hace falta el Cliente.
- `apps/desktop-installer`: no tiene version propia que requiera bump por este cambio
  (el dato real para el Instalador vive en el VPS central, no en el `.exe`), pero si se
  cambio `REMOTE_NODES` conviene reconstruirlo tambien para que el selector del
  Instalador muestre el nombre correcto desde ya.
- **Antes de construir con `npm run service:dist` / `desktop:dist`**: correr `git status`
  y avisar si hay OTROS cambios sin commitear en el arbol de trabajo (de otra tarea en
  curso) — el build empaqueta TODO lo que haya en ese momento, no solo este cambio.
  Confirmar con el usuario si quiere incluirlos o no antes de construir.

**Importante sobre cual instalador usar despues:** verificar la fecha del `.exe` que se
va a usar contra la fecha del commit de este cambio — ya paso una vez que
`herramientas/ejecutables/RockyMaxxInstalador.exe` (copia generica sin version en el
nombre) quedo desactualizada por meses mientras `dist/desktop-installer/Rocky Maxx
Instalador Setup X.Y.Z.exe` si tenia lo nuevo. Si hay dudas, extraer el `app.asar` del
`.exe` candidato (`npx asar extract <ruta.exe o win-unpacked/resources/app.asar> <carpeta>`)
y hacer `grep` del nodo nuevo en `main.js` para confirmar antes de decirle al usuario
"ya esta listo".

## 9. Checklist final

- [ ] `/api/health` del nodo nuevo responde 200, local y publico.
- [ ] El nodo aparece en `GET /api/transfers/sync/nodes` de Central (VPS).
- [ ] El nodo aparece en el selector "Tiendas y bodegas destino" de Cambio de Precio,
      probado en una PC que apunte al mismo backend que se acaba de actualizar.
- [ ] El nodo aparece en el selector "Base remota" del Instalador que se vaya a usar.
- [ ] Si va a transferir con tiendas/bodegas especificas: registrado en ambos extremos
      de cada par (no solo en Central).
- [ ] `KNOWN_SYNC_NODES` y `REMOTE_NODES` actualizados en el codigo fuente.

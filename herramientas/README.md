# herrmaineats

Esta carpeta concentra lo minimo util para que otra IA entienda como instalar, validar y arrancar el proyecto sin tener que reconstruir el contexto desde cero.

## Que hay aqui

- `inventario-tecnico.json`: resumen de runtime, scripts, dependencias, variables de entorno y archivos criticos.
- `scripts/preflight.ps1`: revisa Node, npm, archivo `.env`, variables requeridas y conectividad TCP hacia PostgreSQL.
- `scripts/instalar-y-validar.ps1`: instala dependencias, genera Prisma Client y compila la API.
- `scripts/arrancar-api.ps1`: ejecuta el flujo anterior y luego arranca la API en modo `dev` o `prod`.
- `scripts/*.cmd`: wrappers para lanzar los `.ps1` con `ExecutionPolicy Bypass` en Windows.
- `referencias/`: copias de los manifiestos y archivos tecnicos clave que explican como funciona el arranque.
- `..\docs\api\inventory-merchandise-contract.md`: contrato del backend para crear, editar, buscar y eliminar mercancia.

## Flujo recomendado

Desde la raiz del repo en Windows, usa estos wrappers `.cmd`:

```powershell
.\herrmaineats\scripts\preflight.cmd
.\herrmaineats\scripts\instalar-y-validar.cmd
.\herrmaineats\scripts\arrancar-api.cmd dev
```

Si quieres arrancar en modo produccion:

```powershell
.\herrmaineats\scripts\arrancar-api.cmd prod
```

Si prefieres ejecutar los `.ps1` directamente, usa PowerShell con `-ExecutionPolicy Bypass`.

## Puntos operativos importantes

- El proyecto usa `npm workspaces` con raiz en `package.json`.
- La app principal es `apps/api`, un backend `NestJS + Prisma + PostgreSQL`.
- Prisma intenta conectarse a la base de datos al iniciar el modulo. Si PostgreSQL no responde, la API no levanta.
- Los scripts de esta carpeta estandarizan el uso de `apps/api/.env`. Si no existe ningun `.env`, se crea `apps/api/.env` a partir de `apps/api/.env.example`.
- La API escucha en el puerto definido por `API_PORT`. Con la configuracion de ejemplo queda en `http://localhost:3000/api`.
- El endpoint de salud esperado es `GET /api/health`.

## Runtime verificado en esta maquina

- Node.js: `v24.14.1`
- npm: `10.8.3`

## Variables de entorno minimas

- `DATABASE_URL`
- `API_PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `AUTH_PASSWORD_PEPPER`
- `AUTH_BOOTSTRAP_ADMIN_ENABLED`
- `AUTH_BOOTSTRAP_ADMIN_USERNAME`
- `AUTH_BOOTSTRAP_ADMIN_NAME`
- `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
- `AUTH_BOOTSTRAP_ADMIN_GROUP`

## Nota de alcance

Aqui no se duplican `node_modules` ni secretos reales. La fuente de verdad sigue estando en el repo principal; esta carpeta solo empaqueta el contexto tecnico, los manifiestos y los scripts necesarios para que otra IA o persona pueda operar el proyecto con menos friccion.

## Backups de base de datos

- `backups/rocky_maxx-20260419-215404.custom.dump`: backup real de PostgreSQL en formato custom.
- `backups/rocky_maxx-20260419-215404.full.sql`: backup SQL legible del mismo estado.
- `backups/manifest.json`: hashes, tamaños y metadatos del respaldo.
- `backups/latest-backup.txt`: puntero rapido al backup mas reciente.
- `backups/restaurar-backup.cmd`: wrapper para restaurar el `.custom.dump`.

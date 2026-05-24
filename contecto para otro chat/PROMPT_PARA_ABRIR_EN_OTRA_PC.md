# Prompt para abrir Rocky Maxx en otra PC

Estamos trabajando en el proyecto **Rocky Maxx / sistema arabe**.

Repositorio:

```text
https://github.com/Ian12-sgv/rockyMaxx.git
```

Rama actual:

```text
main
```

Antes de tocar codigo, lee estos archivos del proyecto en este orden:

1. `contecto para otro chat/ACCESO_VPS_Y_GUIA_DE_BASES.md`
2. `contecto para otro chat/CONTEXTO_PARA_OTRO_CHAT.md`
3. `docs/roadmap.md`
4. `apps/api/src/transfers/`
5. `apps/api/src/dev-returns/`
6. `apps/api/src/adjustments/`
7. `apps/api/src/sucursales/`
8. `apps/api/public/app.js`
9. `apps/api/src/app.module.ts`

Luego revisa:

```powershell
git status --short
git diff --stat
```

## Contexto funcional obligatorio

Este proyecto usa PostgreSQL con esquema legacy `dbo`.

No migrar por ahora al modelo moderno `Transfer / TransferItem`. Se trabaja sobre el modelo legacy con tablas como:

- `TRANSFERENCIAS`
- `MOVTRANSFERENCIAS`
- `ITRANSFERENCIAS`
- `IMOVTRANSFERENCIAS`
- `INVENTARIO`
- `SUCURSALES`
- `DEVBORRADOR`
- `MOVDEVBORRADOR`
- `DEVTRANSFERENCIAS`
- `MOVDEVTRANSFERENCIAS`
- `IDEVTRANSFERENCIAS`
- `IMOVDEVTRANSFERENCIAS`
- `AJUSTES`
- `MOVAJUSTES`

Reglas actuales de transferencias:

- El origen registra transferencias.
- Al guardar una transferencia pendiente se descuenta inventario.
- La transferencia pendiente se puede editar.
- Al editar pendiente se ajusta inventario por diferencia.
- Al aprobar pasa a status aprobado.
- La carga de transferencia es para el destino, no para el origen.
- Una transferencia aprobada no debe editarse.
- El modulo de cargar transferencia debe buscar transferencias llegadas, abrirlas, analizarlas, validarlas y aprobar la recepcion.

Reglas actuales de devoluciones:

- Primero se crea un borrador de devolucion.
- El destino revisa y acepta el borrador.
- El origen valida y envia la devolucion real.
- El destino aprueba finalmente la devolucion real.
- En la aprobacion final se llenan `IDEVTRANSFERENCIAS` e `IMOVDEVTRANSFERENCIAS`.

Reglas actuales de ajustes:

- Ajuste positivo suma inventario.
- Ajuste negativo resta inventario.
- `MOVAJUSTES` no lleva `Referencia`.

## Donde quedamos

La fase actual esta enfocada en frontend de escritorio Electron.

Cambios recientes ya hechos:

- Interfaz de `Sucursales` en `Archivos > Sucursales`.
- `Sucursales` tiene crear, guardar, salir, buscar en lista y eliminar por fila.
- Backend de `Sucursales` tiene `DELETE /api/sucursales/:codigo`.
- Login: `Mantener sesion iniciada` ya guarda en `localStorage`; sin marcar usa `sessionStorage`.
- Menu `Procesos` reorganizado:
  - `Borrador devoluciones`
  - `Transferencias` como dropdown:
    - `Registro de transferencias`
    - `Registro de devoluciones`
    - `Carga de transferencias`
    - `Carga de devoluciones`
- Se quito `Movimientos` del menu `Procesos`.
- Pantalla `Registro de transferencias` fue redisenada con formato operativo tipo escritorio.
- Boton `Buscar` en registro de transferencias abre un modal catalogo de transferencias guardadas y aprobadas.
- Boton `Imprimir` abre el dialogo de impresion para guardar como PDF.
- En la grilla de transferencia, el boton dice `Agregar linea`.
- Se quito `Eliminar pendiente` de esa zona.
- Al presionar Enter en `Codigo barra`, el frontend consulta inventario y llena `Referencia`, `Nombre` y existencia de la linea.

## Contexto de despliegue actual

Ahora el proyecto ya no es solo local. Hay dos capas:

- Local:
  - central: `rocky_maxx` en `3000`
  - tienda 001: `rocky_tienda_001` en `3001`
- VPS:
  - central: `rocky_sync_central`
  - tienda 001: `rocky_tienda_001_vps`

El detalle operativo del VPS, servicios, rutas, credenciales y patron para agregar mas tiendas o bodegas ya quedo en:

- `contecto para otro chat/ACCESO_VPS_Y_GUIA_DE_BASES.md`

Ese archivo se debe leer primero si el trabajo toca:

- espejo local -> VPS
- servicios del VPS
- Nginx
- systemd
- nuevas bases de tiendas o bodegas
- cambios de infraestructura

Mapa actual de sedes:

- `ORIGEN` -> `Bodega 001 - GalpoPrincipalMcbo`
- `001` -> `Tienda 001 - RockyMaxxCentro`
- `002` -> `Tienda 002 - Moda shop`
- `003` -> `Tienda 003 - Moda shop 2`
- `004` -> `Tienda 004 - RockyMaxxMcbo`
- `005` -> `Tienda 005 - Titan`
- `006` -> `Tienda 006 - Top shop bqto`
- `B002` -> `Bodega 002 - galpon barquisimeto`

En la nube ya existen:

- `rocky_sync_central`
- `rocky_tienda_001_vps`
- `rocky_tienda_002_vps`
- `rocky_tienda_003_vps`
- `rocky_tienda_004_vps`
- `rocky_tienda_005_vps`
- `rocky_tienda_006_vps`
- `rocky_bodega_002_vps`

Y ya responden estas rutas:

- `http://68.183.105.135/api/health`
- `http://68.183.105.135/tienda001/api/health`
- `http://68.183.105.135/tienda002/api/health`
- `http://68.183.105.135/tienda003/api/health`
- `http://68.183.105.135/tienda004/api/health`
- `http://68.183.105.135/tienda005/api/health`
- `http://68.183.105.135/tienda006/api/health`
- `http://68.183.105.135/bodega002/api/health`

## Como correr en otra PC

Requisitos:

- Windows.
- Node.js instalado.
- PostgreSQL instalado.
- Git instalado.
- PowerShell.

Clonar:

```powershell
git clone https://github.com/Ian12-sgv/rockyMaxx.git
cd rockyMaxx
```

Instalar dependencias:

```powershell
npm ci
```

Configurar `apps/api/.env`:

```env
DATABASE_URL="postgresql://postgres:123456@localhost:5432/rocky_maxx?schema=dbo"
API_PORT=3000
JWT_SECRET="rocky-maxx-local-secret"
JWT_EXPIRES_IN="12h"
AUTH_PASSWORD_PEPPER="rocky-maxx-local-pepper"
AUTH_BOOTSTRAP_ADMIN_ENABLED=true
AUTH_BOOTSTRAP_ADMIN_USERNAME="admin"
AUTH_BOOTSTRAP_ADMIN_NAME="admin"
AUTH_BOOTSTRAP_ADMIN_PASSWORD="123456"
AUTH_BOOTSTRAP_ADMIN_GROUP="admin"
```

Restaurar base de datos desde el backup incluido:

```powershell
$env:PGPASSWORD="123456"
createdb -h localhost -p 5432 -U postgres rocky_maxx
pg_restore -h localhost -p 5432 -U postgres -d rocky_maxx --clean --if-exists "herramientas\backups\rocky_maxx_2026-05-14.bak"
```

Si la base ya existe y quieres reemplazarla:

```powershell
$env:PGPASSWORD="123456"
dropdb -h localhost -p 5432 -U postgres rocky_maxx
createdb -h localhost -p 5432 -U postgres rocky_maxx
pg_restore -h localhost -p 5432 -U postgres -d rocky_maxx --clean --if-exists "herramientas\backups\rocky_maxx_2026-05-14.bak"
```

Validar Prisma y compilar:

```powershell
npm.cmd run prisma:validate --workspace=@sistema-arabe/api
npm.cmd run typecheck --workspace=@sistema-arabe/api
npm.cmd run build --workspace=@sistema-arabe/api
```

Levantar la app de escritorio:

```powershell
npm.cmd run desktop:start:direct
```

Si quieres levantar solo el backend/web en navegador:

```powershell
npm.cmd run dev:api
```

URL web:

```text
http://localhost:3000/
```

Health check:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Si tambien vas a trabajar con tienda 001:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

Login inicial:

```text
Usuario: admin
Clave: 123456
```

Usuario tecnico usado por sincronizacion:

```text
Usuario: sistema
Clave: 456789
```

## Restricciones para continuar

- No reabrir la discusion de migrar a `Transfer / TransferItem` salvo que el usuario lo pida.
- Mantener el esquema legacy `dbo`.
- Continuar pragmaticamente sobre las tablas legacy actuales.
- Antes de editar, revisar siempre `git status --short` y `git diff --stat`.
- Si hay cambios pendientes, no revertirlos sin permiso.
- Si el cambio toca infraestructura o VPS, revisar primero `contecto para otro chat/ACCESO_VPS_Y_GUIA_DE_BASES.md`.

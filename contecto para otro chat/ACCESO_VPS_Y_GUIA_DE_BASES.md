# Acceso al VPS y guia para agregar mas bases

## Leer antes de tocar el VPS

Este archivo es operativo, no solo descriptivo. Contiene:

- acceso actual al VPS
- configuracion activa que ya quedo validada
- donde estan los servicios, envs y rutas
- como subir cambios al VPS
- como agregar mas bases de tiendas o bodegas
- como editar o corregir algo sin romper el despliegue actual

Advertencia:

- este archivo no debe guardar credenciales vivas
- si otro chat necesita acceso, debe pedir al operador la passphrase SSH, la clave de `sudo` y las claves de PostgreSQL

## Estado actual validado

Arquitectura activa:

- Local central:
  - DB: `rocky_maxx`
  - API local: `http://127.0.0.1:3000`
  - espejo hacia VPS: `http://68.183.105.135`
- Local tienda 001:
  - DB: `rocky_tienda_001`
  - API local: `http://127.0.0.1:3001`
  - espejo hacia VPS: `http://68.183.105.135/tienda001`
- VPS central:
  - DB: `rocky_sync_central`
  - API publica: `http://68.183.105.135`
- VPS tienda 001:
  - DB: `rocky_tienda_001_vps`
  - API publica: `http://68.183.105.135/tienda001`

Health checks ya validados:

- `http://68.183.105.135/api/health`
- `http://68.183.105.135/tienda001/api/health`

## Acceso al VPS

Datos actuales:

- IP publica: `68.183.105.135`
- Hostname: `rocky-maxx-sync-prod-01`
- Usuario SSH: `deploy`
- Root por SSH: deshabilitado
- PasswordAuthentication: deshabilitado
- PubkeyAuthentication: habilitado

Llave local en esta PC:

- `C:\Users\ianbo\.ssh\id_ed25519_rocky_vps`

Comando de acceso desde PowerShell en esta PC:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_rocky_vps deploy@68.183.105.135
```

Si pide passphrase de la llave o password de `sudo`:

- solicitarlo al operador actual
- no guardarlo en este archivo ni subirlo a git

Para elevar dentro del VPS:

```bash
sudo -s
```

## Rutas importantes en el VPS

Codigo del proyecto:

- `/home/deploy/apps/rockyMaxx`

API:

- `/home/deploy/apps/rockyMaxx/apps/api`

Env central del VPS:

- `/home/deploy/apps/rockyMaxx/apps/api/.env`

Env de tienda 001 en el VPS:

- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda001`

Servicios systemd:

- `/etc/systemd/system/rocky-maxx-api.service`
- `/etc/systemd/system/rocky-maxx-api-tienda001.service`

Nginx:

- `/etc/nginx/sites-available/rocky-maxx`
- `/etc/nginx/sites-enabled/rocky-maxx`

## Bases actuales en PostgreSQL del VPS

Usuario PostgreSQL actual del despliegue:

- usuario: `rocky`
- clave: solicitarla al operador actual

Bases ya creadas:

- `rocky_sync_central`
- `rocky_tienda_001_vps`

Verificacion rapida:

```bash
sudo -u postgres psql -lqt | grep rocky_
```

## Configuracion exacta actual del VPS

### Servicio central

Archivo:

- `/etc/systemd/system/rocky-maxx-api.service`

Resumen:

- WorkingDirectory: `/home/deploy/apps/rockyMaxx/apps/api`
- puerto interno: `3000`
- usa el env principal `.env`

### Servicio tienda 001

Archivo:

- `/etc/systemd/system/rocky-maxx-api-tienda001.service`

Resumen:

- WorkingDirectory: `/home/deploy/apps/rockyMaxx/apps/api`
- EnvironmentFile: `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda001`
- puerto interno: `3001`

### Nginx actual

Archivo:

- `/etc/nginx/sites-available/rocky-maxx`

Rutas actuales:

- `/` -> `http://127.0.0.1:3000`
- `/tienda001/` -> `http://127.0.0.1:3001/`

## Configuracion local actual que apunta al VPS

Central local:

- archivo: `apps/api/.env`
- `MIRROR_SYNC_ENABLED=true`
- `MIRROR_SYNC_REMOTE_API_URL="http://68.183.105.135"`
- `MIRROR_SYNC_USERNAME="sistema"`
- `MIRROR_SYNC_PASSWORD="<pedir al operador>"`

Tienda 001 local:

- archivo: `apps/api/.env.tienda001`
- `MIRROR_SYNC_ENABLED=true`
- `MIRROR_SYNC_REMOTE_API_URL="http://68.183.105.135/tienda001"`
- `MIRROR_SYNC_USERNAME="sistema"`
- `MIRROR_SYNC_PASSWORD="<pedir al operador>"`

## Nota importante sobre el servicio local de escritorio

Archivo de perfil guardado del back local:

- `C:\Users\ianbo\AppData\Roaming\@sistema-arabe\desktop-service\service-config.json`

Estado visto al final de esta etapa:

- ese archivo quedo con `profileId = ".env.tienda001"`
- pero la ultima validacion del central local en `3000` se hizo levantando el runtime instalado directamente

Si otro chat necesita arrancar el servicio local de escritorio y quiere central, revisar primero ese JSON o cambiar el perfil desde la UI del servicio local.

## Como entrar y verificar el VPS rapido

```bash
cd /home/deploy/apps/rockyMaxx
git log -1 --oneline
systemctl list-units --type=service --all | grep rocky-maxx-api
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1/api/health
curl -s http://127.0.0.1/tienda001/api/health
```

## Como subir cambios nuevos al VPS

Hacer esto despues de actualizar el repo o despues de editar algo:

```bash
cd /home/deploy/apps/rockyMaxx
git pull
npm install
npm run prisma:generate
npm run prisma:validate
npm run build:api
sudo systemctl restart rocky-maxx-api
sudo systemctl restart rocky-maxx-api-tienda001
sudo systemctl status rocky-maxx-api --no-pager
sudo systemctl status rocky-maxx-api-tienda001 --no-pager
curl -s http://127.0.0.1/api/health
curl -s http://127.0.0.1/tienda001/api/health
```

Si se agrega una nueva tienda o bodega, tambien hay que reiniciar su nuevo servicio systemd.

## Regla actual para agregar mas tiendas o bodegas al VPS

Convencion recomendada:

- Central VPS:
  - DB: `rocky_sync_central`
  - ruta publica: `/`
  - puerto interno: `3000`
- Tienda 001 VPS:
  - DB: `rocky_tienda_001_vps`
  - ruta publica: `/tienda001/`
  - puerto interno: `3001`
- Tienda 002 VPS:
  - DB sugerida: `rocky_tienda_002_vps`
  - ruta publica sugerida: `/tienda002/`
  - puerto interno sugerido: `3002`
- Tienda 003 VPS:
  - DB sugerida: `rocky_tienda_003_vps`
  - ruta publica sugerida: `/tienda003/`
  - puerto interno sugerido: `3003`
- Bodega 002 VPS:
  - DB sugerida: `rocky_bodega_002_vps`
  - ruta publica sugerida: `/bodega002/`
  - puerto interno sugerido: `3010`

La regla importante es:

- un servicio Node por perfil remoto
- un env por perfil remoto
- una base PostgreSQL por perfil remoto
- una ruta Nginx por perfil remoto

## Pasos para agregar una nueva tienda en el VPS

Ejemplo para `tienda002`.

### 1. Crear la base PostgreSQL

```bash
sudo -u postgres createdb -O rocky rocky_tienda_002_vps
sudo -u postgres psql -lqt | grep rocky_tienda_002_vps
```

### 2. Crear el env remoto

Crear:

- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda002`

Contenido base:

```dotenv
DATABASE_URL="postgresql://rocky:<clave-postgres-vps>@localhost:5432/rocky_tienda_002_vps?schema=dbo"
API_PORT=3002
API_HOST=127.0.0.1
JWT_SECRET="rocky-vps-store-002-secret-2026"
JWT_EXPIRES_IN="12h"
AUTH_PASSWORD_PEPPER="rocky-vps-store-002-pepper-2026"
AUTH_BOOTSTRAP_ADMIN_ENABLED=false
AUTH_BOOTSTRAP_ADMIN_USERNAME="admin"
AUTH_BOOTSTRAP_ADMIN_NAME="admin"
AUTH_BOOTSTRAP_ADMIN_PASSWORD="<definir>"
AUTH_BOOTSTRAP_ADMIN_GROUP="admin"
AUTH_BOOTSTRAP_SYSTEM_ENABLED=true
AUTH_BOOTSTRAP_SYSTEM_USERNAME="sistema"
AUTH_BOOTSTRAP_SYSTEM_NAME="sistema"
AUTH_BOOTSTRAP_SYSTEM_PASSWORD="<definir>"
AUTH_BOOTSTRAP_SYSTEM_GROUP="sistema"
AUTH_BOOTSTRAP_SYSTEM_GROUP_NAME="Sistema"
TRANSFER_SYNC_AUTO_RETRY_ENABLED=true
TRANSFER_SYNC_AUTO_RETRY_INTERVAL_MS=30000
TRANSFER_SYNC_AUTO_RETRY_STARTUP_DELAY_MS=5000
TRANSFER_SYNC_AUTO_RETRY_LIMIT=25
MIRROR_SYNC_ENABLED=false
MIRROR_SYNC_REMOTE_API_URL=""
MIRROR_SYNC_USERNAME="sistema"
MIRROR_SYNC_PASSWORD="<pedir al operador>"
MIRROR_SYNC_AUTO_RETRY_INTERVAL_MS=30000
MIRROR_SYNC_AUTO_RETRY_STARTUP_DELAY_MS=5000
MIRROR_SYNC_AUTO_RETRY_LIMIT=25
```

### 3. Crear el servicio systemd

Crear:

- `/etc/systemd/system/rocky-maxx-api-tienda002.service`

Contenido:

```ini
[Unit]
Description=Rocky Maxx API Tienda 002
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/home/deploy/apps/rockyMaxx/apps/api
EnvironmentFile=/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda002
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 4. Agregar la ruta en Nginx

Editar:

- `/etc/nginx/sites-available/rocky-maxx`

Agregar antes del `location /` general:

```nginx
location /tienda002/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 5. Recargar todo

```bash
cd /home/deploy/apps/rockyMaxx
npm install
npm run prisma:generate
npm run prisma:validate
npm run build:api
sudo systemctl daemon-reload
sudo systemctl enable rocky-maxx-api-tienda002
sudo systemctl restart rocky-maxx-api-tienda002
sudo nginx -t
sudo systemctl restart nginx
curl -s http://127.0.0.1:3002/api/health
curl -s http://127.0.0.1/tienda002/api/health
```

## Pasos para agregar una nueva bodega en el VPS

La logica es la misma que una tienda. Solo cambia:

- nombre de base, ejemplo `rocky_bodega_002_vps`
- ruta publica, ejemplo `/bodega002/`
- env remoto, ejemplo `.env.vps.bodega002`
- servicio, ejemplo `rocky-maxx-api-bodega002.service`
- puerto, ejemplo `3010`

Ejemplo de health final:

```bash
curl -s http://127.0.0.1:3010/api/health
curl -s http://127.0.0.1/bodega002/api/health
```

## Como conectar una nueva tienda o bodega local a su ruta del VPS

Ejemplo tienda 002 local:

Crear o editar:

- `apps/api/.env.tienda002`

Con estos puntos clave:

```dotenv
DATABASE_URL="postgresql://postgres:<clave-local>@localhost:5432/rocky_tienda_002?schema=dbo"
API_PORT=3002
MIRROR_SYNC_ENABLED=true
MIRROR_SYNC_REMOTE_API_URL="http://68.183.105.135/tienda002"
MIRROR_SYNC_USERNAME="sistema"
MIRROR_SYNC_PASSWORD="<pedir al operador>"
```

Ejemplo bodega 002 local:

- `apps/api/.env.bodega002`

Con:

```dotenv
DATABASE_URL="postgresql://postgres:<clave-local>@localhost:5432/rocky_bodega_002?schema=dbo"
API_PORT=3010
MIRROR_SYNC_ENABLED=true
MIRROR_SYNC_REMOTE_API_URL="http://68.183.105.135/bodega002"
MIRROR_SYNC_USERNAME="sistema"
MIRROR_SYNC_PASSWORD="<pedir al operador>"
```

## Comandos utiles para editar y diagnosticar

Ver servicios:

```bash
systemctl list-units --type=service --all | grep rocky-maxx-api
```

Ver logs:

```bash
journalctl -u rocky-maxx-api -n 100 --no-pager
journalctl -u rocky-maxx-api-tienda001 -n 100 --no-pager
```

Reiniciar central:

```bash
sudo systemctl restart rocky-maxx-api
```

Reiniciar tienda 001:

```bash
sudo systemctl restart rocky-maxx-api-tienda001
```

Editar Nginx:

```bash
sudo nano /etc/nginx/sites-available/rocky-maxx
sudo nginx -t
sudo systemctl restart nginx
```

Ver env central:

```bash
cat /home/deploy/apps/rockyMaxx/apps/api/.env
```

Ver env tienda 001:

```bash
cat /home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda001
```

Ver bases:

```bash
sudo -u postgres psql -lqt | grep rocky_
```

Entrar a PostgreSQL:

```bash
sudo -u postgres psql
```

## Si algo queda mal

Orden recomendado:

1. revisar `git log -1 --oneline`
2. revisar el env del perfil afectado
3. revisar `systemctl status` del servicio afectado
4. revisar `journalctl -u <servicio>`
5. revisar `nginx -t`
6. probar el health interno por puerto
7. probar el health publico por ruta

Ejemplo para tienda 001:

```bash
sudo systemctl status rocky-maxx-api-tienda001 --no-pager
journalctl -u rocky-maxx-api-tienda001 -n 100 --no-pager
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1/tienda001/api/health
```

## Resumen rapido

Lo que ya existe hoy:

- VPS central listo
- VPS tienda 001 lista
- local central espejando al VPS
- local tienda 001 espejando al VPS

Patron para crecer:

- una DB por nodo en el VPS
- un env por nodo
- un servicio Node por nodo
- una ruta Nginx por nodo
- el nodo local apunta a su ruta remota con `MIRROR_SYNC_REMOTE_API_URL`

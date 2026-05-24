# Acceso al VPS y guia para agregar mas bases

## Leer antes de tocar el VPS

Este archivo es operativo, no solo descriptivo. Resume:

- acceso actual al VPS
- estado validado local + VPS
- bases creadas
- servicios `systemd`
- rutas Nginx
- como diagnosticar
- patron real para crecer con mas tiendas y bodegas

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
- Local tienda 002:
  - DB: `rocky_tienda_002`
  - API local prevista: `http://127.0.0.1:3002`
- Local tienda 003:
  - DB: `rocky_tienda_003`
  - API local prevista: `http://127.0.0.1:3003`
- Local tienda 004:
  - DB: `rocky_tienda_004`
  - API local prevista: `http://127.0.0.1:3004`
- Local tienda 005:
  - DB: `rocky_tienda_005`
  - API local prevista: `http://127.0.0.1:3005`
- Local tienda 006:
  - DB: `rocky_tienda_006`
  - API local prevista: `http://127.0.0.1:3006`
- Local bodega 002:
  - DB: `rocky_bodega_002`
  - API local prevista: `http://127.0.0.1:3007`
- VPS central:
  - DB: `rocky_sync_central`
  - API publica: `http://68.183.105.135`
- VPS tienda 001:
  - DB: `rocky_tienda_001_vps`
  - API publica: `http://68.183.105.135/tienda001`
- VPS tienda 002:
  - DB: `rocky_tienda_002_vps`
  - API publica: `http://68.183.105.135/tienda002`
- VPS tienda 003:
  - DB: `rocky_tienda_003_vps`
  - API publica: `http://68.183.105.135/tienda003`
- VPS tienda 004:
  - DB: `rocky_tienda_004_vps`
  - API publica: `http://68.183.105.135/tienda004`
- VPS tienda 005:
  - DB: `rocky_tienda_005_vps`
  - API publica: `http://68.183.105.135/tienda005`
- VPS tienda 006:
  - DB: `rocky_tienda_006_vps`
  - API publica: `http://68.183.105.135/tienda006`
- VPS bodega 002:
  - DB: `rocky_bodega_002_vps`
  - API publica: `http://68.183.105.135/bodega002`

Health checks publicos ya validados:

- `http://68.183.105.135/api/health`
- `http://68.183.105.135/tienda001/api/health`
- `http://68.183.105.135/tienda002/api/health`
- `http://68.183.105.135/tienda003/api/health`
- `http://68.183.105.135/tienda004/api/health`
- `http://68.183.105.135/tienda005/api/health`
- `http://68.183.105.135/tienda006/api/health`
- `http://68.183.105.135/bodega002/api/health`

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

Envs remotos:

- `/home/deploy/apps/rockyMaxx/apps/api/.env`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda001`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda002`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda003`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda004`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda005`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda006`
- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.bodega002`

Servicios `systemd`:

- `/etc/systemd/system/rocky-maxx-api.service`
- `/etc/systemd/system/rocky-maxx-api-tienda001.service`
- `/etc/systemd/system/rocky-maxx-api-tienda002.service`
- `/etc/systemd/system/rocky-maxx-api-tienda003.service`
- `/etc/systemd/system/rocky-maxx-api-tienda004.service`
- `/etc/systemd/system/rocky-maxx-api-tienda005.service`
- `/etc/systemd/system/rocky-maxx-api-tienda006.service`
- `/etc/systemd/system/rocky-maxx-api-bodega002.service`

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
- `rocky_tienda_002_vps`
- `rocky_tienda_003_vps`
- `rocky_tienda_004_vps`
- `rocky_tienda_005_vps`
- `rocky_tienda_006_vps`
- `rocky_bodega_002_vps`

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

### Servicios adicionales

- `rocky-maxx-api-tienda001.service` -> `.env.vps.tienda001` -> puerto `3001`
- `rocky-maxx-api-tienda002.service` -> `.env.vps.tienda002` -> puerto `3002`
- `rocky-maxx-api-tienda003.service` -> `.env.vps.tienda003` -> puerto `3003`
- `rocky-maxx-api-tienda004.service` -> `.env.vps.tienda004` -> puerto `3004`
- `rocky-maxx-api-tienda005.service` -> `.env.vps.tienda005` -> puerto `3005`
- `rocky-maxx-api-tienda006.service` -> `.env.vps.tienda006` -> puerto `3006`
- `rocky-maxx-api-bodega002.service` -> `.env.vps.bodega002` -> puerto `3007`

### Nginx actual

Archivo:

- `/etc/nginx/sites-available/rocky-maxx`

Rutas actuales:

- `/` -> `http://127.0.0.1:3000`
- `/tienda001/` -> `http://127.0.0.1:3001/`
- `/tienda002/` -> `http://127.0.0.1:3002/`
- `/tienda003/` -> `http://127.0.0.1:3003/`
- `/tienda004/` -> `http://127.0.0.1:3004/`
- `/tienda005/` -> `http://127.0.0.1:3005/`
- `/tienda006/` -> `http://127.0.0.1:3006/`
- `/bodega002/` -> `http://127.0.0.1:3007/`

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

Perfiles locales adicionales creados en esta PC:

- `apps/api/.env.tienda002`
- `apps/api/.env.tienda003`
- `apps/api/.env.tienda004`
- `apps/api/.env.tienda005`
- `apps/api/.env.tienda006`
- `apps/api/.env.bodega002`

Nota:

- esos perfiles locales estan ignorados por git
- si otra PC necesita esas mismas sedes locales, hay que recrear esos `.env` manualmente

## Nota importante sobre el servicio local de escritorio

Archivo de configuracion guardado del back local:

- `C:\Users\ianbo\AppData\Local\Programs\@sistema-arabedesktop-service\service-config.json`

Estado visto al final de esta etapa:

- el servicio local ya guarda la configuracion junto a la instalacion
- la base queda fijada despues del primer guardado
- la replica espejo hacia el VPS puede editarse despues sin reinstalar

## Estado actual de nombres de sedes

Tanto en local como en VPS se normalizo este catalogo:

- `ORIGEN` -> `Bodega 001 - GalpoPrincipalMcbo`
- `001` -> `Tienda 001 - RockyMaxxCentro`
- `002` -> `Tienda 002 - Moda shop`
- `003` -> `Tienda 003 - Moda shop 2`
- `004` -> `Tienda 004 - RockyMaxxMcbo`
- `005` -> `Tienda 005 - Titan`
- `006` -> `Tienda 006 - Top shop bqto`
- `B002` -> `Bodega 002 - galpon barquisimeto`

En `SYNC_NODES` quedaron estos nodos:

- `ORIGEN`
- `TIENDA001`
- `TIENDA002`
- `TIENDA003`
- `TIENDA004`
- `TIENDA005`
- `TIENDA006`
- `BODEGA002`

## Como entrar y verificar el VPS rapido

```bash
cd /home/deploy/apps/rockyMaxx
git log -1 --oneline
systemctl list-units --type=service --all | grep rocky-maxx-api
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1:3002/api/health
curl -s http://127.0.0.1:3003/api/health
curl -s http://127.0.0.1:3004/api/health
curl -s http://127.0.0.1:3005/api/health
curl -s http://127.0.0.1:3006/api/health
curl -s http://127.0.0.1:3007/api/health
curl -s http://127.0.0.1/api/health
curl -s http://127.0.0.1/tienda001/api/health
curl -s http://127.0.0.1/tienda002/api/health
curl -s http://127.0.0.1/tienda003/api/health
curl -s http://127.0.0.1/tienda004/api/health
curl -s http://127.0.0.1/tienda005/api/health
curl -s http://127.0.0.1/tienda006/api/health
curl -s http://127.0.0.1/bodega002/api/health
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
sudo systemctl restart rocky-maxx-api-tienda002
sudo systemctl restart rocky-maxx-api-tienda003
sudo systemctl restart rocky-maxx-api-tienda004
sudo systemctl restart rocky-maxx-api-tienda005
sudo systemctl restart rocky-maxx-api-tienda006
sudo systemctl restart rocky-maxx-api-bodega002
sudo systemctl status rocky-maxx-api --no-pager
sudo systemctl status rocky-maxx-api-tienda001 --no-pager
sudo systemctl status rocky-maxx-api-tienda002 --no-pager
sudo systemctl status rocky-maxx-api-tienda003 --no-pager
sudo systemctl status rocky-maxx-api-tienda004 --no-pager
sudo systemctl status rocky-maxx-api-tienda005 --no-pager
sudo systemctl status rocky-maxx-api-tienda006 --no-pager
sudo systemctl status rocky-maxx-api-bodega002 --no-pager
curl -s http://127.0.0.1/api/health
curl -s http://127.0.0.1/tienda001/api/health
curl -s http://127.0.0.1/tienda002/api/health
curl -s http://127.0.0.1/tienda003/api/health
curl -s http://127.0.0.1/tienda004/api/health
curl -s http://127.0.0.1/tienda005/api/health
curl -s http://127.0.0.1/tienda006/api/health
curl -s http://127.0.0.1/bodega002/api/health
```

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
  - DB: `rocky_tienda_002_vps`
  - ruta publica: `/tienda002/`
  - puerto interno: `3002`
- Tienda 003 VPS:
  - DB: `rocky_tienda_003_vps`
  - ruta publica: `/tienda003/`
  - puerto interno: `3003`
- Tienda 004 VPS:
  - DB: `rocky_tienda_004_vps`
  - ruta publica: `/tienda004/`
  - puerto interno: `3004`
- Tienda 005 VPS:
  - DB: `rocky_tienda_005_vps`
  - ruta publica: `/tienda005/`
  - puerto interno: `3005`
- Tienda 006 VPS:
  - DB: `rocky_tienda_006_vps`
  - ruta publica: `/tienda006/`
  - puerto interno: `3006`
- Bodega 002 VPS:
  - DB: `rocky_bodega_002_vps`
  - ruta publica: `/bodega002/`
  - puerto interno: `3007`

La regla importante es:

- una base PostgreSQL por nodo
- un env por nodo
- un servicio Node por nodo
- una ruta Nginx por nodo

## Pasos para agregar una nueva tienda o bodega en el VPS

Ejemplo para `tienda002`.

### 1. Crear la base PostgreSQL

```bash
sudo -u postgres createdb -O rocky rocky_tienda_002_vps
sudo -u postgres psql -lqt | grep rocky_tienda_002_vps
```

### 2. Restaurar o poblar la base

Si viene de una base local ya llena, copiar sus datos y luego asegurar `dbo` para `rocky`.

Regla practica:

- restaurar
- `ALTER SCHEMA dbo OWNER TO rocky`
- dar `GRANT ALL` sobre schema, tablas, secuencias y funciones de `dbo`

### 3. Crear el env remoto

Crear:

- `/home/deploy/apps/rockyMaxx/apps/api/.env.vps.tienda002`

Base:

```dotenv
DATABASE_URL="postgresql://rocky:<clave-postgres-vps>@localhost:5432/rocky_tienda_002_vps?schema=dbo"
API_PORT=3002
API_HOST=127.0.0.1
JWT_SECRET="rocky-vps-store-002-secret-2026"
JWT_EXPIRES_IN="12h"
AUTH_PASSWORD_PEPPER="rocky-vps-store-002-pepper-2026"
AUTH_BOOTSTRAP_ADMIN_ENABLED=false
AUTH_BOOTSTRAP_SYSTEM_ENABLED=true
TRANSFER_SYNC_AUTO_RETRY_ENABLED=true
MIRROR_SYNC_ENABLED=false
MIRROR_SYNC_REMOTE_API_URL=""
```

### 4. Crear el servicio systemd

Crear:

- `/etc/systemd/system/rocky-maxx-api-tienda002.service`

Patron:

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

### 5. Agregar la ruta en Nginx

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

### 6. Recargar todo

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

Para una bodega nueva, el patron es igual; solo cambian:

- DB, por ejemplo `rocky_bodega_003_vps`
- ruta, por ejemplo `/bodega003/`
- servicio, por ejemplo `rocky-maxx-api-bodega003.service`
- puerto

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
API_PORT=3007
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
journalctl -u rocky-maxx-api-tienda002 -n 100 --no-pager
journalctl -u rocky-maxx-api-bodega002 -n 100 --no-pager
```

Editar Nginx:

```bash
sudo nano /etc/nginx/sites-available/rocky-maxx
sudo nginx -t
sudo systemctl restart nginx
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

Ejemplo para tienda 002:

```bash
sudo systemctl status rocky-maxx-api-tienda002 --no-pager
journalctl -u rocky-maxx-api-tienda002 -n 100 --no-pager
curl -s http://127.0.0.1:3002/api/health
curl -s http://127.0.0.1/tienda002/api/health
```

## Resumen rapido

Lo que ya existe hoy:

- VPS central listo
- VPS tienda 001 lista
- VPS tienda 002 lista
- VPS tienda 003 lista
- VPS tienda 004 lista
- VPS tienda 005 lista
- VPS tienda 006 lista
- VPS bodega 002 lista
- local central espejando al VPS
- local tienda 001 espejando al VPS

Patron para crecer:

- una DB por nodo en el VPS
- un env por nodo
- un servicio Node por nodo
- una ruta Nginx por nodo
- el nodo local apunta a su ruta remota con `MIRROR_SYNC_REMOTE_API_URL`

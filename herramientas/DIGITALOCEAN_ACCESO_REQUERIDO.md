# Acceso requerido para operar Rocky Maxx en DigitalOcean

Para administrar el VPS de Rocky Maxx con acceso completo y dejar el modo híbrido funcionando, necesito lo siguiente:

## 1. Acceso al VPS

- IP pública del droplet.
- Usuario SSH con permisos `sudo`.
- Método de acceso:
  - preferido: llave privada `.pem` / `.ppk`
  - alterno: contraseña temporal del usuario

## 2. Acceso a la cuenta o al proyecto de DigitalOcean

- Acceso al proyecto donde vive el droplet, o
- token de API de DigitalOcean con permisos para:
  - droplets
  - firewalls
  - volumes
  - networking
  - project resources

Si se va a automatizar despliegue o revisar recursos desde la plataforma, el token debe ser de lectura y escritura.

## 3. Datos de red y dominio

- Dominio o subdominio que apuntará al API, si aplica.
- Confirmación de si el acceso será por:
  - IP pública directa
  - VPN
  - WireGuard / Tailscale
  - red privada entre nodos

## 4. Base de datos del VPS

Definir cuál de estas dos opciones se usará:

- PostgreSQL dentro del mismo droplet
- PostgreSQL administrado aparte

Y compartir:

- host
- puerto
- nombre de la base
- usuario
- contraseña
- esquema, si no es el predeterminado

## 5. Variables y secretos de la aplicación

Necesito el valor final o la decisión operativa para:

- `DATABASE_URL`
- `API_PORT`
- `JWT_SECRET`
- `TRANSFER_SYNC_USERNAME`
- `TRANSFER_SYNC_PASSWORD`
- URL pública o privada del API del VPS

## 6. Estado del despliegue actual

Necesito saber si ya existe algo corriendo:

- Node / NestJS
- PM2, NSSM o servicio Windows/Linux
- Nginx o reverse proxy
- certificados SSL
- backups automáticos

## 7. Recomendación operativa para este proyecto

Con la arquitectura híbrida actual:

- local:
  - artículos
  - existencia
  - ajustes
  - catálogos de la sede
- VPS:
  - transferencias
  - devoluciones
  - borradores
  - notificaciones entre sedes

Si me compartes esos accesos, el siguiente paso es conectar la URL del VPS en el panel de conectividad y validar el flujo híbrido completo.

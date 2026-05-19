# Rocky Maxx en red local

## Objetivo

Este proyecto quedó dividido en dos ejecutables para trabajo local en red:

- `Rocky Maxx Servicio Local`
  - va en la PC principal
  - levanta el backend y usa la base de datos local
- `Rocky Maxx Cliente`
  - va en cualquier PC de la misma red
  - solo abre la interfaz contra la URL de la PC principal

## Flujo recomendado

### 1. PC principal

Instalar y abrir:

- `Rocky Maxx Servicio Local Setup 2.1.2.exe`

Ese ejecutable:

- levanta el backend en `http://127.0.0.1:3000`
- intenta exponer también la URL por LAN
- muestra las URLs que pueden usar las PCs cliente

### 2. PCs cliente

Instalar y abrir:

- `Rocky Maxx Cliente Setup 2.1.2.exe`

Al abrirlo:

- pide la URL del servidor local
- ejemplo: `http://192.168.1.10:3000`
- prueba la conexión
- guarda la URL y abre la interfaz

## Requisitos de red

- la PC principal debe estar encendida
- PostgreSQL debe existir en esa misma PC principal
- el puerto `3000` debe permitir acceso en firewall de Windows
- las demás PCs deben estar en la misma red LAN

## Arquitectura actual

- base de datos: solo en la PC principal
- backend/API: solo en la PC principal
- frontend cliente: en cualquier PC

## Siguiente fase

Cuando el modo local quede estable, se puede agregar el segundo destino:

- `Local`
- `VPS`

sin romper el flujo LAN.

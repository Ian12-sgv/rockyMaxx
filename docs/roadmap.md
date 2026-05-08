# Roadmap

## Iniciativas

### Plataforma sucursal-local + nube central

Estado: planned

Objetivo:
Permitir que cada sucursal siga operando aunque pierda internet, manteniendo trabajo multi-computadora dentro del local, y sincronizando luego con la nube central cuando la conectividad vuelva.

Arquitectura objetivo:

- Frontend: web o desktop, indistinto.
- Backend por sucursal: NestJS local.
- Base por sucursal: PostgreSQL local.
- Nube: otro NestJS + PostgreSQL central.
- Sync: a nivel aplicacion, con outbox/inbox, versionado y reintentos.

### Como operara

- Cada sucursal tendra un servidor local propio dentro del negocio.
- Todas las computadoras de esa sucursal se conectaran al backend local por LAN.
- El backend local seguira funcionando aunque la sucursal pierda acceso a internet.
- Cuando haya conectividad, un modulo de sincronizacion intercambiara cambios entre la sucursal y la nube central.
- El frontend no deberia cambiar manualmente entre "usar local" y "usar VPS" como flujo principal de operacion. La operacion diaria debe apuntar al backend local de la sucursal, y la nube quedara para sincronizacion, consolidacion y administracion central.

### Por que esta iniciativa existe

- El cliente trabajara en varios locales.
- Dentro de cada local habra varias computadoras usando el sistema al mismo tiempo.
- Un enfoque por computadora con base local propia complicaria demasiado la consistencia y los conflictos.
- Un enfoque por sucursal permite mantener operacion offline real sin perder soporte multiusuario dentro del local.

### Alcance funcional esperado

- Ventas, compras, movimientos, caja e inventario de una sucursal deben poder registrarse sin internet.
- La sucursal debe seguir consultando su propia data operativa aun sin internet.
- La nube debe consolidar informacion de todas las sucursales cuando la conexion vuelva.
- Debe existir visibilidad de estado:
  - conectado a servidor local
  - sin conexion a nube
  - pendientes por sincronizar
  - sincronizacion con errores
  - sincronizacion al dia

## Fases

### Fase 0. Descubrimiento y contratos

Objetivo:
Definir ownership de datos, reglas de conflicto y alcance exacto de sincronizacion antes de tocar infraestructura.

Entregables:

- inventario de entidades que seran locales por sucursal
- inventario de entidades que seran globales
- matriz de ownership por modulo
- reglas de resolucion de conflictos
- contrato inicial de eventos de sincronizacion

Decision esperada por entidad:

- Solo nube:
  - catalogos corporativos
  - configuraciones globales
  - politicas y permisos corporativos
- Solo sucursal con replicacion ascendente:
  - ventas
  - compras
  - movimientos de inventario
  - caja
  - cierres
- Mixto con reglas:
  - productos
  - clientes
  - precios

### Fase 1. Preparar el modelo multi-sucursal

Objetivo:
Hacer que el modelo actual soporte identidad de sucursal y trazabilidad de origen.

Cambios previstos:

- agregar `branchId` o equivalente a todas las entidades operativas
- agregar `originNodeId` o `sourceNodeId` para saber donde se origino cada cambio
- agregar `version` o `rowVersion` para control de concurrencia
- estandarizar `createdAt`, `updatedAt`, `deletedAt` y `lastSyncedAt`
- usar identificadores globales estables, preferiblemente UUID, para nuevas entidades

Notas:

- Las claves de negocio legacy pueden seguir existiendo, pero no deben ser el mecanismo principal de sincronizacion.
- Esta fase es prerequisito para cualquier sync robusto.

### Fase 2. Backend local por sucursal

Objetivo:
Convertir el backend actual en un nodo desplegable por sucursal.

Cambios previstos:

- empaquetar NestJS para despliegue local estable
- parametrizar el backend con identidad de sucursal y de nodo
- agregar healthchecks locales y de conectividad con nube
- exponer un canal seguro para sync con la nube

Resultado esperado:

- cada sucursal puede correr su propio backend y su propia base PostgreSQL local
- las PCs cliente apuntan solo al backend local de su sucursal

### Fase 3. Nube central

Objetivo:
Crear el backend y la base central que concentraran informacion de todas las sucursales.

Responsabilidades de la nube:

- consolidacion
- administracion central
- reportes globales
- distribucion de cambios globales hacia sucursales
- auditoria y monitoreo de sincronizacion

Cambios previstos:

- desplegar un NestJS central separado del backend de sucursal
- definir una base PostgreSQL central con trazabilidad por sucursal
- agregar endpoints de recepcion y entrega de lotes de sync

### Fase 4. Motor de sincronizacion a nivel aplicacion

Objetivo:
Sincronizar cambios sin depender de replicacion bidireccional automatica de PostgreSQL.

Modelo:

- outbox:
  - cada cambio confirmado en la sucursal genera un evento pendiente de exportacion
- inbox:
  - cada cambio recibido desde la nube se registra antes de aplicarse
- checkpoints:
  - cada nodo recuerda hasta donde sincronizo con cada contraparte
- retries:
  - si falla una entrega, el evento queda pendiente y se reintenta
- idempotencia:
  - el mismo mensaje no debe aplicarse dos veces

Tablas previstas:

- `sync_nodes`
- `sync_outbox`
- `sync_outbox_attempts`
- `sync_inbox`
- `sync_checkpoints`
- `sync_conflicts`

Campos tipicos por evento:

- `eventId`
- `aggregateType`
- `aggregateId`
- `operation`
- `branchId`
- `originNodeId`
- `version`
- `payload`
- `createdAt`
- `availableAt`
- `attemptCount`
- `status`

### Fase 5. Endpoints y workers de sync

Objetivo:
Implementar el intercambio real entre sucursal y nube.

Backend sucursal:

- worker que empuja outbox a la nube
- worker que consulta cambios descendentes desde la nube
- aplicador transaccional para inbox

Backend nube:

- endpoint de recepcion de lotes de sucursales
- endpoint de entrega de lotes pendientes para cada sucursal
- validacion de versiones y deteccion de conflictos

Reglas tecnicas:

- lotes pequenos y reintentables
- confirmacion explicita por evento o por lote
- firmas o autenticacion por nodo
- timeouts cortos y reanudacion por checkpoint

### Fase 6. Manejo de conflictos

Objetivo:
Resolver bien los casos donde la misma entidad cambia en dos lados incompatibles.

Regla general:

- evitar conflicto por diseno siempre que sea posible

Enfoque recomendado:

- ventas, caja e inventario operativo:
  - ownership de sucursal
- catalogos globales:
  - ownership de nube
- clientes o datos compartidos:
  - merge controlado o revision manual segun el caso

No hacer:

- last-write-wins para todo
- permitir escritura libre del mismo registro en todos los nodos sin ownership

### Fase 7. UI y experiencia operativa

Objetivo:
Hacer visible el estado de conectividad y sincronizacion sin convertirlo en una operacion manual compleja.

Cambios previstos:

- en Ayuda o Configuracion:
  - estado de servidor local
  - estado de nube
  - hora de ultima sincronizacion
  - cantidad de pendientes
  - boton `Sincronizar ahora`
  - panel de errores de sincronizacion

Comportamiento esperado:

- si la nube cae, el sistema sigue operando localmente
- si vuelve internet, el backend local reintenta sincronizar en segundo plano
- el usuario no necesita cambiar de modo para seguir vendiendo o consultando

### Fase 8. Observabilidad, backups y soporte

Objetivo:
Asegurar operabilidad real en produccion.

Requisitos:

- logs de sync por nodo
- metricas de pendientes, errores y latencia
- backup local por sucursal
- backup central
- herramientas de reproceso
- trazabilidad por evento

## Implementacion futura en este repo

### Cambios de backend

- crear un modulo `sync`
- separar configuracion de `nodeType`:
  - `branch`
  - `cloud`
- agregar jobs programados para push y pull
- agregar DTOs y contratos de lote
- agregar auditoria de eventos aplicados

### Cambios de base de datos

- nuevas tablas de sync
- nuevas columnas de ownership y versionado en entidades operativas
- indices por `branchId`, `status`, `availableAt`, `aggregateId`

### Cambios de frontend

- mostrar estado local/nube
- mostrar pendientes de sincronizacion
- permitir reprocesar sync desde soporte
- mantener frontend desacoplado del modo de despliegue:
  - web apuntando al backend local
  - desktop apuntando al backend local

### Cambios de despliegue

- instalador o bundle de sucursal con:
  - PostgreSQL local
  - backend NestJS local
  - servicio de arranque
- despliegue central independiente para VPS

## Criterios para iniciar esta iniciativa

- cerrar fase actual del producto base
- definir modelo de sucursales y permisos
- estabilizar modulos core:
  - inventario
  - ventas
  - compras
  - usuarios
- acordar con negocio que datos son locales, globales o mixtos

## Riesgos principales

- intentar sincronizar tablas legacy sin ownership claro
- usar claves de negocio no globales como identidad principal
- mezclar cambios de esquema con sync sin versionado del contrato
- replicar al mismo tiempo desde varios nodos sobre las mismas filas sin estrategia de conflictos

## Decision actual

Esta arquitectura queda aprobada para roadmap, pero no para implementacion inmediata.

Cuando se aborde, la estrategia recomendada es:

1. preparar el modelo multi-sucursal
2. desplegar backend y PostgreSQL por sucursal
3. crear nube central
4. implementar sync a nivel aplicacion con outbox/inbox
5. exponer estado de sincronizacion en la UI

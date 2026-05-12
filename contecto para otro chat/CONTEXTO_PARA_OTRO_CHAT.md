# CONTEXTO PARA OTRO CHAT

## Leer Esto Primero

Este proyecto esta en `H:\sistema arabe`.

El siguiente chat debe leer primero este archivo y despues, si necesita detalle, revisar:

1. `docs/roadmap.md`
2. `apps/api/src/transfers/`
3. `apps/api/public/app.js`

## Objetivo General Del Proyecto

Sistema Rocky Maxx con:

- frontend actual tipo shell de escritorio
- backend NestJS
- PostgreSQL con esquema legacy `dbo`
- soporte actual para inventario, roles, usuarios y autenticacion
- plan de arquitectura futura multi-sucursal ya documentado en roadmap

Arquitectura futura ya acordada y documentada:

- Frontend: web o desktop, indistinto
- Backend por sucursal: NestJS local
- Base por sucursal: PostgreSQL local
- Nube: otro NestJS + PostgreSQL central
- Sync: a nivel aplicacion, con outbox/inbox, versionado y reintentos

## Donde Quedamos

Se implemento la **fase 1 de transferencias** usando el modelo legacy, sin migrar a `Transfer/TransferItem`.

La implementacion se hizo sobre estas tablas:

- `TRANSFERENCIAS`
- `MOVTRANSFERENCIAS`
- `ITRANSFERENCIAS`
- `IMOVTRANSFERENCIAS`
- `INVENTARIO`
- `DEVBORRADOR`
- `MOVDEVBORRADOR`
- `IDEVTRANSFERENCIAS`
- `IMOVDEVTRANSFERENCIAS`
- `DEVTRANSFERENCIAS`
- `MOVDEVTRANSFERENCIAS`
- `AJUSTES`
- `MOVAJUSTES`

`DEVTRANSFERENCIAS` y `MOVDEVTRANSFERENCIAS` ya se conectaron al cierre de la devolucion desde backend.
Se agrego `DEVBORRADOR` porque la base solo tenia `MOVDEVBORRADOR`.
Campos de `DEVBORRADOR`: `Numero`, `Fecha`, `Observacion`, `Usuario`, `Status`.
`MOVDEVBORRADOR.Numero` queda relacionado con `DEVBORRADOR.Numero`.
`MOVDEVBORRADOR.CodigoBarra` queda relacionado con `INVENTARIO.CodigoBarra`.

## Reglas De Negocio Ya Definidas Con El Usuario

### Fase 1 de transferencias

- el usuario arma la transferencia
- en los renglones de transferencia el usuario solo captura datos operativos minimos:
  - `CodigoBarra`
  - `Referencia`
  - nombre del articulo como informacion visual tomada de inventario cuando esta disponible
  - caja
  - cantidad
  - lote
  - existencia de lote / existencia visible
  - total calculado
- al guardar o aprobar, el sistema consulta `INVENTARIO` usando `CodigoBarra + Referencia` para tomar la ficha completa del articulo
- no se debe depender de precios o atributos escritos manualmente en la transferencia
- ningun campo del formulario de transferencia debe bloquear el guardado como borrador
- si el usuario no llena origen, el backend usa `ORIGEN`
- si el usuario no llena destino, el backend usa `DESTINO`
- si el usuario no llena renglones, se guarda una transferencia pendiente sin movimientos
- si un renglon tiene `CodigoBarra` pero no tiene `Referencia`, el backend toma la referencia vigente desde `INVENTARIO`
- aprobar sigue exigiendo que existan renglones validos, porque una transferencia sin articulos no tiene movimiento que aprobar
- el sistema genera `Numero`
- al guardar, la transferencia queda con `Status = 0`
- al guardar, se descuenta inventario del origen
- mientras `Status = 0`, la transferencia puede editarse
- si se edita una pendiente, el inventario del origen se ajusta por diferencia
- si se elimina una pendiente, se devuelve al inventario lo descontado al guardar
- al aprobar, `Status` pasa a `1`
- al aprobar, se valida la recepcion contra `INVENTARIO` usando `CodigoBarra + Referencia + CodigoMarca`
- al aprobar, siempre se refrescan los datos del articulo desde `INVENTARIO`, no desde los valores que quedaron guardados cuando se creo la transferencia
- al aprobar, se registra la transferencia recibida en `ITRANSFERENCIAS`
- al aprobar, se registran los renglones recibidos en `IMOVTRANSFERENCIAS`
- si una transferencia se crea hoy y se aprueba semanas despues, los atributos, costos/precios de movimiento y `TotalValor` se recalculan con la informacion vigente en `INVENTARIO`
- si existe un articulo que coincide con `CodigoBarra + Referencia + CodigoMarca`, se suma la cantidad recibida y se sincronizan los atributos del articulo desde el origen
- si no existe ese articulo, se crea en `INVENTARIO` copiando la ficha completa del articulo origen y cargando la cantidad recibida
- si al aprobar aparece un codigo de barra usado por otro articulo que no coincide con la identidad esperada, el backend devuelve `TRANSFER_DUPLICATE_BARCODE`
- la UI pregunta si se quiere modificar el articulo existente o crear un articulo nuevo
- si se elige modificar, se actualizan los atributos del articulo existente y se suma la existencia recibida
- si se elige crear nuevo, la UI pide un nuevo codigo de barra porque el original ya esta usado; el backend crea el articulo con ese nuevo codigo y los atributos recibidos
- una transferencia aprobada no puede editarse

### Flujo legacy de devoluciones

- las devoluciones funcionan parecido a transferencias, pero tienen una fase previa de borrador
- primero se crea un borrador en `DEVBORRADOR` y `MOVDEVBORRADOR`
- el destino revisa el borrador y envia una aceptacion del borrador al origen
- esa aceptacion del borrador solo cambia el estado del borrador; todavia no llena `IDEVTRANSFERENCIAS` ni `IMOVDEVTRANSFERENCIAS`
- luego el origen valida esa aceptacion y envia la devolucion real
- al aprobar el origen, se llenan `DEVTRANSFERENCIAS` y `MOVDEVTRANSFERENCIAS`
- cuando llega la devolucion real, el destino la aprueba finalmente
- en esa aprobacion final del destino se llenan automaticamente `IDEVTRANSFERENCIAS` e `IMOVDEVTRANSFERENCIAS`
- campos de `DEVTRANSFERENCIAS`: `Numero`, `Fecha`, `CodigoEnvia`, `CodigoRecibe`, `DocumentoOrigen`/codigo origen, `TotalValor`, `Observacion`, `Status`, `Usuario`, `FechaEmision`, `InterContable`, `IDLote`
- campos de `MOVDEVTRANSFERENCIAS`: `Numero`, `Fecha`, `CodigoBarra`, `Cantidad`, `Valor`, `NumeroCaja`, `Item`, `UltimoCosto`, `CostoInicial`, `CostoDolar`
- limitacion actual: `DEVBORRADOR` no guarda `CodigoEnvia`, `CodigoRecibe`, `IDLote` ni `InterContable`; esos datos se pasan al aprobar el borrador/devolucion
- limitacion actual: `INVENTARIO` sigue siendo global, no separado por sucursal

Endpoints backend agregados para devoluciones:

- `GET /api/dev-returns/drafts`
- `GET /api/dev-returns/drafts/:numero`
- `POST /api/dev-returns/drafts`
- `POST /api/dev-returns/drafts/:numero/destination-approve`
- `POST /api/dev-returns/drafts/:numero/origin-approve`
- `POST /api/dev-returns/:numero/destination-approve`

### Flujo legacy de ajustes

- el proceso `AJUSTE` modifica directamente la mercancia en `INVENTARIO`
- ajuste positivo suma existencia
- ajuste negativo resta existencia
- se registra encabezado en `AJUSTES`
- se registran renglones en `MOVAJUSTES`, relacionados con `AJUSTES` por `Numero`
- campos de `AJUSTES`: `Numero`, `TipoAjuste`, `Signo`, `Fecha`, `TotalValor`, `Observacion`, `Usuario`, `InterContable`, `Status`, `IDLote`
- campos de `MOVAJUSTES`: `Numero`, `CodigoBarra`, `Cantidad`, `Costo`
- el ajuste busca y valida el articulo por `CodigoBarra`
- `Status` se guarda en `1` para que las vistas legacy `VW_AJUSTESPOSITIVOS` y `VW_AJUSTESNEGATIVOS` lo tomen como aplicado
- en ajustes negativos, si la existencia no alcanza, el backend rechaza el ajuste

Endpoints backend agregados para ajustes:

- `GET /api/adjustments`
- `GET /api/adjustments/:numero`
- `POST /api/adjustments`

### Validaciones ya acordadas

- `CodigoEnvia` y `CodigoRecibe` no pueden ser iguales
- debe existir al menos un renglon
- la cantidad debe ser mayor a cero
- si `existencia_origen >= cantidad_a_enviar`, se permite
- si `existencia_origen < cantidad_a_enviar`, no se permite

## Implementacion Hecha

### Backend nuevo

Se creo el modulo:

- `apps/api/src/transfers/transfers.module.ts`
- `apps/api/src/transfers/transfers.controller.ts`
- `apps/api/src/transfers/transfers.service.ts`
- `apps/api/src/transfers/transfer-view.util.ts`
- `apps/api/src/transfers/dto/`

Y se conecto en:

- `apps/api/src/app.module.ts`

Tambien se agrego el modulo legacy de sucursales:

- `apps/api/src/sucursales/sucursales.module.ts`
- `apps/api/src/sucursales/sucursales.controller.ts`
- `apps/api/src/sucursales/sucursales.service.ts`
- `apps/api/src/sucursales/sucursal-view.util.ts`
- `apps/api/src/sucursales/dto/`

### Endpoints nuevos

- `GET /api/transfers/metadata`
- `GET /api/transfers`
- `GET /api/transfers/:numero`
- `POST /api/transfers`
- `PATCH /api/transfers/:numero`
- `POST /api/transfers/:numero/approve`
- `DELETE /api/transfers/:numero`

### Endpoints de sucursales

- `GET /api/sucursales`
- `GET /api/sucursales/:codigo`
- `POST /api/sucursales`
- `PATCH /api/sucursales/:codigo`

### Frontend nuevo

Se agrego una pantalla minima de transferencias dentro de:

- `apps/api/public/app.js`

El flujo de transferencias quedo separado en dos modulos de UI:

- menu `Procesos`
- opcion `Registro de transferencia`
- opcion `Cargar transferencia`

`Registro de transferencia` permite:

- crear transferencia
- agregar y quitar renglones
- guardar transferencia pendiente
- editar mientras `Status = 0`
- aprobar
- eliminar una transferencia pendiente

`Cargar transferencia` permite:

- que el destino busque transferencias llegadas por numero, origen, destino, documento, observacion o usuario
- ubicar documentos pendientes/aprobados que corresponden al proceso de recepcion
- cargar el documento en una vista de recepcion dentro del mismo modulo
- revisar y analizar los articulos enviados en solo lectura
- validar y aprobar la recepcion desde el modulo del destino
- al aprobar, se valida y se afecta `INVENTARIO`
- no debe entenderse como modulo del origen ni como modulo de edicion; este modulo solo busca transferencias llegadas, las abre para revision y permite validarlas/aprobarlas

Tambien se agrego pantalla para:

- menu `Archivos`
- opcion `Sucursales`
- listar tiendas/bodegas
- crear sucursal con todos los campos libres para el usuario
- editar `Codigo`, `Nombre`, `Direccion`, `Telefono`, `Status` y `PorcentajeDeRedondeo`
- mostrar `Status = 1` como abierta y `Status = 0` como cerrada

## Comportamiento Tecnico Importante

### Sobre `Numero`

Se genera automaticamente tomando `MAX(TRANSFERENCIAS.Numero) + 1`.

### Sobre `IDLote`

Como la base actual puede venir sin lotes, el sistema crea automaticamente un lote tecnico:

- `TR_AUTO`

Descripcion:

- `Lote automatico para transferencias`

### Sobre `IDDespacho`

Se usa por defecto:

- `0`

Eso coincide con `TIPO_DESPACHO.ID = 0`:

- `SIN DEFINIR`

### Sobre `SUCURSALES`

La base restaurada actual puede venir sin filas en `SUCURSALES`.

Por eso, si `CodigoEnvia` o `CodigoRecibe` no existen, el modulo los crea automaticamente con:

- `Codigo = codigo enviado`
- `Nombre = codigo enviado`
- `Status = 1`
- `PorcentajeDeRedondeo = 0`

## Limitacion Real Del Esquema Actual

Esto es importante para el siguiente chat:

Aunque en la conversacion funcional se hablo de inventario por sucursal o bodega, el esquema actual visible en Prisma y en la base restaurada trabaja con `INVENTARIO` como existencia por articulo, no con saldo separado por ubicacion dentro de la misma tabla.

Consecuencia:

- la fase 1 ya funciona sobre el `INVENTARIO` actual
- pero todavia no existe un verdadero saldo independiente por sucursal dentro de una sola base
- eso queda alineado con la arquitectura futura de sucursal-local + nube central, no resuelto dentro de esta fase

No perder esto en el siguiente chat:

- **la fase 1 quedo funcional**
- **pero no resuelve aun inventario multi-ubicacion real dentro de la misma tabla `INVENTARIO`**

## Validacion Que Ya Se Hizo

Se validaron estos pasos:

- `npm.cmd run typecheck --workspace=@sistema-arabe/api`
- `npm.cmd run build --workspace=@sistema-arabe/api`
- `node --check apps/api/public/app.js`

Smoke test real recomendado despues del ajuste actual:

1. se subio temporalmente `INVENTARIO.Existencia` del articulo `123456789` a `10`
2. se creo una transferencia de prueba `TESTSRC -> TESTDST`
3. al guardar, el stock bajo en el origen
4. al aprobar, se valido y se recibio en destino usando los datos vigentes de `INVENTARIO`
5. se limpiaron los datos de prueba y el inventario quedo restaurado a su estado original

Resultado esperado del smoke test:

- `statusAfterSave = 0`
- `statusAfterApprove = 1`
- guardar desconto inventario del origen
- aprobar aplico la recepcion del destino

## Continuacion Implementada Despues Del Handoff Inicial

Se agrego eliminacion de transferencias pendientes:

- solo se permite eliminar si `Status = 0`
- al eliminar, se revierte inventario devolviendo lo descontado al guardar
- se eliminan los renglones de `MOVTRANSFERENCIAS`
- se elimina el encabezado de `TRANSFERENCIAS`
- si la transferencia ya esta aprobada (`Status = 1`), el backend responde conflicto
- la pantalla de `Procesos > Transferencias` ahora muestra `Eliminar pendiente` para documentos pendientes

Smoke test real recomendado para eliminacion pendiente despues del ajuste actual:

- `npm.cmd run typecheck --workspace=@sistema-arabe/api`
- `npm.cmd run build --workspace=@sistema-arabe/api`
- `node --check apps/api/public/app.js`
- smoke test contra base usando usuario legacy `admin`:
  - se subio temporalmente `INVENTARIO.Existencia` del articulo `123456789` a `10`
  - se creo una transferencia pendiente temporal `TESTDEL -> TESTDST`
  - al guardar, el stock bajo a `9`
  - al eliminar, el stock volvio a `10`
  - `TRANSFERENCIAS` ya no tenia el documento eliminado
  - se limpio la data temporal y se restauro el inventario original

Smoke test real recomendado para aprobacion por identidad de articulo despues del ajuste actual:

- `npm.cmd run typecheck --workspace=@sistema-arabe/api`
- `npm.cmd run build --workspace=@sistema-arabe/api`
- `node --check apps/api/public/app.js`
- smoke test contra base usando usuario legacy `admin`:
  - se subio temporalmente `INVENTARIO.Existencia` del articulo `123456789` a `10`
  - se creo una transferencia temporal `TESTSRC -> TESTDST`
  - al guardar, el stock bajo a `9`
  - al aprobar, se busco el articulo por `CodigoBarra + Referencia + CodigoMarca`
  - al aprobar, se aplico la recepcion del destino
  - `Status` paso de `0` a `1`
  - se limpio la data temporal y se restauro el inventario original

Precision posterior:

- la aprobacion tambien sincroniza atributos del articulo cuando existe coincidencia, incluyendo nombre, talla, color, fabricante, categoria, impuesto, precios, costos, promocion, punto de reorden, status, tipo, serializado y codigo de familia/anterior
- por la limitacion actual de `INVENTARIO.CodigoBarra` como clave primaria, no se puede crear otro articulo con el mismo codigo de barra y distinta referencia o marca dentro de la misma tabla
- si al crear mercancia o al recibir una transferencia se detecta un `CodigoBarra` duplicado, el backend responde conflicto con el mensaje `Codigo de barra duplicado.`, que el frontend muestra como alerta
- para aprobacion de transferencias, ese conflicto ahora se puede resolver desde la UI: modificar el articulo existente o crear uno nuevo indicando otro `CodigoBarra`
- la aprobacion refresca `Valor`, `UltimoCosto`, `CostoInicial`, `CostoDolar` y `TotalValor` desde `INVENTARIO` antes de cambiar `Status` a `1`

### Modulo Sucursales

Se trabaja sobre la tabla legacy `SUCURSALES` con estos campos:

- `Codigo`
- `Nombre`
- `Direccion`
- `Telefono`
- `Status`
- `PorcentajeDeRedondeo`

Reglas implementadas:

- el formulario no obliga al usuario a llenar campos
- si no se envia `Codigo`, el backend genera uno numerico
- si no se envia `Nombre`, se usa el `Codigo` como nombre tecnico
- si no se envia `Status`, queda `1` por defecto
- `Status = 0` significa cerrada
- `Status = 1` significa abierta
- si no se envia `PorcentajeDeRedondeo`, queda `0`
- aunque Prisma marca `Direccion` y `Telefono` como opcionales, la base restaurada puede exigir NOT NULL; por eso el backend guarda cadena vacia cuando el usuario no llena esos campos

## Estado Actual Del Repositorio

Hay cambios locales sin commit al momento de crear este documento.

Archivos principales tocados:

- `apps/api/src/app.module.ts`
- `apps/api/src/transfers/`
- `apps/api/public/app.js`

## Lo Que Falta O Conviene Hacer Despues

### Siguiente paso funcional recomendado

Cerrar la fase 1 con estas decisiones pendientes:

- definir si se quiere bloqueo adicional por usuario creador o si cualquier admin puede aprobar
- definir si hace falta una auditoria historica de eliminaciones de transferencias pendientes
- validar con smoke test real que al aprobar se llenan `ITRANSFERENCIAS` e `IMOVTRANSFERENCIAS`

### Siguiente paso de producto recomendado

Despues de cerrar fase 1:

- pasar a la siguiente parte del roadmap multi-sucursal

### Riesgo a vigilar

Como `INVENTARIO` no esta separado por ubicacion dentro de la base actual:

- no vender esta fase como solucion final de stock distribuido por sucursal
- venderla como fase 1 sobre el modelo legacy actual

## Prompt Recomendado Para El Siguiente Chat

Usa este prompt para continuar sin rehacer contexto:

> Lee primero `contecto para otro chat/CONTEXTO_PARA_OTRO_CHAT.md`. Estamos en `H:\\sistema arabe`. Ya se implemento la fase 1 de transferencias usando `TRANSFERENCIAS`, `MOVTRANSFERENCIAS` e `INVENTARIO`, con guardado pendiente que descuenta inventario del origen, edicion mientras `Status = 0` ajustando por diferencia, eliminacion pendiente que devuelve lo descontado, y aprobacion desde destino para validar/recibir y sumar/crear segun corresponda. Quiero continuar desde ese punto sin cambiar al modelo moderno `Transfer/TransferItem`. Revisa los archivos tocados y dime el siguiente paso exacto para seguir.

## Nota Final Para El Siguiente Chat

No reabrir la discusion de refactor a `Transfer/TransferItem` salvo que el usuario lo pida.

La instruccion vigente del usuario es:

- mantener el modelo legacy por ahora
- avanzar pragmáticamente sobre la estructura actual

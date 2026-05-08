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
- `INVENTARIO`

Todavia **no** se implemento `ITRANSFERENCIAS`, `IMOVTRANSFERENCIAS` ni `DEVTRANSFERENCIAS` como parte del flujo funcional nuevo. Solo se respetaron como contexto del modelo legacy.

## Reglas De Negocio Ya Definidas Con El Usuario

### Fase 1 de transferencias

- el usuario arma la transferencia
- el sistema genera `Numero`
- al guardar, la transferencia queda con `Status = 0`
- al guardar, se descuenta inventario del origen
- mientras `Status = 0`, la transferencia puede editarse
- si se edita, el ajuste de inventario en origen debe hacerse por delta, no recontando todo desde cero
- al aprobar, `Status` pasa a `1`
- al aprobar, se valida la recepcion contra `INVENTARIO` usando `CodigoBarra + Referencia + CodigoMarca`
- si existe un articulo que coincide con `CodigoBarra + Referencia + CodigoMarca`, se suma la cantidad recibida y se sincronizan los atributos del articulo desde el origen
- si no existe ese articulo, se crea en `INVENTARIO` copiando la ficha completa del articulo origen y cargando la cantidad recibida
- una transferencia aprobada no puede editarse

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

### Endpoints nuevos

- `GET /api/transfers/metadata`
- `GET /api/transfers`
- `GET /api/transfers/:numero`
- `POST /api/transfers`
- `PATCH /api/transfers/:numero`
- `POST /api/transfers/:numero/approve`
- `DELETE /api/transfers/:numero`

### Frontend nuevo

Se agrego una pantalla minima de transferencias dentro de:

- `apps/api/public/app.js`

La vista aparece en:

- menu `Procesos`
- opcion `Transferencias`

La pantalla permite:

- crear transferencia
- agregar y quitar renglones
- guardar transferencia pendiente
- abrir transferencia existente
- editar mientras `Status = 0`
- aprobar
- eliminar una transferencia pendiente

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

Tambien se hizo un smoke test real contra la base:

1. se subio temporalmente `INVENTARIO.Existencia` del articulo `123456789` a `10`
2. se creo una transferencia de prueba `TESTSRC -> TESTDST`
3. al guardar, el stock bajo a `9.00`
4. al aprobar, el stock volvio a `10.00`
5. se limpiaron los datos de prueba y el inventario quedo restaurado a su estado original

Resultado del smoke test:

- `statusAfterSave = 0`
- `statusAfterApprove = 1`
- el descuento y la suma funcionaron

## Continuacion Implementada Despues Del Handoff Inicial

Se agrego eliminacion de transferencias pendientes:

- solo se permite eliminar si `Status = 0`
- al eliminar, se revierte el descuento hecho al origen sumando nuevamente las cantidades a `INVENTARIO`
- se eliminan los renglones de `MOVTRANSFERENCIAS`
- se elimina el encabezado de `TRANSFERENCIAS`
- si la transferencia ya esta aprobada (`Status = 1`), el backend responde conflicto y no modifica inventario
- la pantalla de `Procesos > Transferencias` ahora muestra `Eliminar pendiente` para documentos pendientes

Validacion adicional realizada despues de implementar eliminacion:

- `npm.cmd run typecheck --workspace=@sistema-arabe/api`
- `npm.cmd run build --workspace=@sistema-arabe/api`
- `node --check apps/api/public/app.js`
- smoke test real contra base usando usuario legacy `admin`:
  - se subio temporalmente `INVENTARIO.Existencia` del articulo `123456789` a `10`
  - se creo una transferencia pendiente temporal `TESTDEL -> TESTDST`
  - al guardar, el stock bajo a `9`
  - al eliminar, el stock volvio a `10`
  - `TRANSFERENCIAS` ya no tenia el documento eliminado
  - se limpio la data temporal y se restauro el inventario original

Validacion adicional realizada despues de ajustar aprobacion por identidad de articulo:

- `npm.cmd run typecheck --workspace=@sistema-arabe/api`
- `npm.cmd run build --workspace=@sistema-arabe/api`
- `node --check apps/api/public/app.js`
- smoke test real contra base usando usuario legacy `admin`:
  - se subio temporalmente `INVENTARIO.Existencia` del articulo `123456789` a `10`
  - se creo una transferencia temporal `TESTSRC -> TESTDST`
  - al guardar, el stock bajo a `9`
  - al aprobar, se busco el articulo por `CodigoBarra + Referencia + CodigoMarca`
  - al aprobar, el stock volvio a `10`
  - `Status` paso de `0` a `1`
  - se limpio la data temporal y se restauro el inventario original

Precision posterior:

- la aprobacion tambien sincroniza atributos del articulo cuando existe coincidencia, incluyendo nombre, talla, color, fabricante, categoria, impuesto, precios, costos, promocion, punto de reorden, status, tipo, serializado y codigo de familia/anterior
- por la limitacion actual de `INVENTARIO.CodigoBarra` como clave primaria, no se puede crear otro articulo con el mismo codigo de barra y distinta referencia o marca dentro de la misma tabla
- si al crear mercancia o al recibir una transferencia se detecta un `CodigoBarra` duplicado, el backend responde conflicto con el mensaje `Codigo de barra duplicado.`, que el frontend muestra como alerta

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

### Siguiente paso de producto recomendado

Despues de cerrar fase 1:

- implementar `ITRANSFERENCIAS` e `IMOVTRANSFERENCIAS`
- o pasar a la siguiente parte del roadmap multi-sucursal

### Riesgo a vigilar

Como `INVENTARIO` no esta separado por ubicacion dentro de la base actual:

- no vender esta fase como solucion final de stock distribuido por sucursal
- venderla como fase 1 sobre el modelo legacy actual

## Prompt Recomendado Para El Siguiente Chat

Usa este prompt para continuar sin rehacer contexto:

> Lee primero `contecto para otro chat/CONTEXTO_PARA_OTRO_CHAT.md`. Estamos en `H:\\sistema arabe`. Ya se implemento la fase 1 de transferencias usando `TRANSFERENCIAS`, `MOVTRANSFERENCIAS` e `INVENTARIO`, con guardado pendiente, descuento en origen, aprobacion y suma en destino. Quiero continuar desde ese punto sin cambiar al modelo moderno `Transfer/TransferItem`. Revisa los archivos tocados y dime el siguiente paso exacto para seguir.

## Nota Final Para El Siguiente Chat

No reabrir la discusion de refactor a `Transfer/TransferItem` salvo que el usuario lo pida.

La instruccion vigente del usuario es:

- mantener el modelo legacy por ahora
- avanzar pragmáticamente sobre la estructura actual

# PROMPT PARA OTRO CHAT

Usa este prompt exactamente en el siguiente chat:

```text
Estamos trabajando en el proyecto ubicado en H:\sistema arabe.

No quiero volver a explicar el contexto manualmente. Construye tu contexto leyendo primero estos archivos del proyecto, en este orden:

1. H:\sistema arabe\contecto para otro chat\CONTEXTO_PARA_OTRO_CHAT.md
2. H:\sistema arabe\docs\roadmap.md
3. H:\sistema arabe\apps\api\src\transfers\
4. H:\sistema arabe\apps\api\public\app.js
5. H:\sistema arabe\apps\api\src\app.module.ts

Luego revisa tambien el estado actual del working tree para no perder nada que haya quedado pendiente:

- git status --short
- git diff --stat

Contexto operativo importante que debes asumir desde el inicio:

- Este proyecto usa PostgreSQL con esquema legacy dbo.
- No quiero migrar por ahora al modelo moderno Transfer / TransferItem.
- Quiero seguir trabajando con el modelo legacy de transferencias.
- Ya se implemento la fase 1 de transferencias.
- La fase 1 se hizo sobre TRANSFERENCIAS, MOVTRANSFERENCIAS e INVENTARIO.
- El flujo acordado es:
  - guardar transferencia pendiente con Status = 0
  - descontar inventario al guardar
  - permitir editar mientras Status = 0
  - al aprobar pasar a Status = 1
  - sumar inventario al aprobar
  - una vez aprobada no se puede editar

Restricciones que no debes olvidar:

- No reabras la discusion de refactor a Transfer / TransferItem a menos que yo lo pida.
- No me pidas que vuelva a explicarte el contexto general si ya esta en los archivos anteriores.
- Si detectas una limitacion real del esquema actual, senalala con precision tecnica, pero continua pragmáticamente sobre el modelo legacy.

Despues de leer todo eso, no quiero una respuesta generica. Quiero que hagas esto:

1. Resume en pocas lineas donde quedo el proyecto.
2. Dime exactamente que ya esta implementado y verificado.
3. Dime que falta o que riesgo tecnico sigue abierto.
4. Proponme el siguiente paso mas logico.
5. Si el siguiente paso ya esta suficientemente claro, empieza a implementarlo sin esperar a que te repita todo el contexto.

Si encuentras algo importante en los archivos o en git status/diff que no este mencionado en el handoff, tomalo como fuente de verdad mas reciente y dilo explicitamente.
```

## Nota

Si el siguiente chat sigue bien este prompt, no deberia hacer falta reconstruir el contexto desde cero.

# Electron And UI

## Process Boundaries

Keep the Electron layers separate:

- `main`: window lifecycle, menus, printing, filesystem access, updater, OS integrations.
- `preload`: narrow and typed IPC bridge.
- `renderer`: React screens, forms, tables, navigation, and user workflows.

Default to:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` when compatible with the chosen libraries

Do not expose raw filesystem, shell, or database access to the renderer.

## IPC Strategy

- Define IPC request and response contracts in `packages/contracts`.
- Keep IPC names domain-oriented, not implementation-oriented.
- Return normalized result shapes for success, validation failure, permission denial, and unexpected failure.
- Version or deprecate IPC contracts when packaging old clients matters.

If a workflow can go through the Nest backend, prefer that over inventing desktop-only persistence paths.

## Renderer Architecture

If no frontend framework is fixed, use React with:

- `@tanstack/react-query` for backend state,
- `react-hook-form` and `zod` for large operator forms,
- `zustand` only for local UI state or draft state not owned by the server.

Keep screens task-oriented. Common desktop backoffice patterns:

- list plus detail,
- create or edit drawer,
- batch actions,
- approval queues,
- printable documents,
- imports and exports,
- keyboard-first navigation.

## UX Rules For Management Systems

- Optimize for speed and repeatability, not marketing-style presentation.
- Keep filters visible on dense tables.
- Preserve operator context after save, print, or secondary actions.
- Make destructive actions explicit and reversible when the domain allows it.
- Show record status, last update, and ownership information near the working area.
- Design offline or degraded states intentionally if the desktop app must survive network instability.

## Desktop-Specific Concerns

- Keep updater strategy explicit from the beginning.
- Design printing and PDF export as first-class workflows if invoices, receipts, or reports exist.
- Isolate barcode scanners, serial devices, or printers behind explicit services if hardware integration is required.
- Keep secrets out of renderer bundles and local plain-text storage.

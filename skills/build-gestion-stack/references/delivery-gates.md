# Delivery Gates

## Minimum Quality Bar

Define and keep working commands for:

- `lint`
- `typecheck`
- `test`
- `e2e`
- `build`
- desktop packaging

Do not accept broad feature work without knowing how each command is expected to pass.

## Test Strategy

Cover these layers:

- unit tests for pure domain and utility logic,
- integration tests for NestJS modules plus Prisma behavior,
- contract tests for shared payloads and IPC boundaries,
- Electron end-to-end flows for login, core CRUD, printing or export, and permission-sensitive actions.

Prioritize regression coverage on:

- migrations,
- stock or financial calculations,
- role and permission changes,
- IPC contracts,
- destructive actions,
- import and export flows.

## Security Gates

- Review auth flow, session storage, and password hashing.
- Confirm RBAC or permission checks exist in the backend, not only in the UI.
- Confirm preload exposure is minimal and typed.
- Confirm secrets do not land in renderer code or logs.
- Confirm audit coverage for critical workflows.

## Release And Operations

- Keep environment variables typed and documented in code.
- Fail builds on lint, type, or test regressions before packaging.
- Stamp release artifacts with a version tied to a commit or changelog source.
- Capture startup and fatal error logs for both backend and desktop processes.
- Decide early how updates are delivered and how migrations are coordinated with client rollout.

## Observability

At minimum, capture:

- request or correlation IDs,
- actor or user identifiers,
- module and operation names,
- error category,
- duration for critical queries and commands.

If the system handles money, inventory, or legal records, keep logs and audit history distinct.

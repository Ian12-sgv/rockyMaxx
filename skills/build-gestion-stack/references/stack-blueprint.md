# Stack Blueprint

## Workspace Shape

Prefer a modular monorepo with these top-level areas:

- `apps/api`: NestJS HTTP or IPC-facing backend.
- `apps/desktop`: Electron main, preload, and renderer entrypoints.
- `packages/contracts`: shared request, response, event, and IPC schemas.
- `packages/ui`: design tokens, reusable components, table and form primitives.
- `packages/config`: shared ESLint, TypeScript, Vitest or Jest, and build config.
- `prisma` or `packages/db`: Prisma schema, migrations, seed data, and DB utilities.

Start with a modular monolith unless scale, isolation, or team topology clearly demand service extraction.

## Module Design

Split by business capability, not by framework layer alone. Typical contexts:

- `auth`
- `users`
- `customers`
- `inventory`
- `purchases`
- `sales`
- `billing`
- `reports`
- `audit`

Within each backend module, prefer this shape:

- `domain`: entities, value objects, invariants, policies.
- `application`: use cases, commands, queries, orchestrators.
- `infrastructure`: Prisma repositories, gateways, adapters.
- `presentation`: controllers, DTO mappers, filters, transport glue.

Keep controllers thin. Keep repositories persistence-focused. Put business rules in application or domain layers.

## Recommended Libraries

### Backend

- `@nestjs/config` for environment config.
- `@nestjs/swagger` for API contracts and discovery.
- `@nestjs/passport`, `@nestjs/jwt`, `passport`, and `argon2` for auth.
- `@nestjs/throttler` for rate protection on exposed endpoints.
- `nestjs-pino` and `pino` for structured logs.
- `class-validator` and `class-transformer` for Nest DTOs when transport-only validation is enough.
- `zod` in `packages/contracts` when the same schema must be shared by backend and desktop.
- `BullMQ` only when background work is real and durable jobs are required.

### Database

- `prisma` as the default ORM and migration tool.
- `pg` for raw SQL escape hatches, reporting queries, or migration utilities.

### Desktop and Renderer

- `electron` with `electron-builder` for packaging.
- `vite` for fast renderer builds.
- `react` for the renderer if the frontend framework is not already fixed.
- `react-router` for screen routing.
- `@tanstack/react-query` for server state.
- `react-hook-form` plus `zod` for dense form workflows.
- `zustand` for local UI state that should not live in the server cache.

## Contract Strategy

Choose one source of truth per boundary:

- Use shared `zod` schemas in `packages/contracts` when backend and desktop both depend on the same payload shape.
- Use Nest DTOs at the controller boundary when the contract is backend-local.
- Version contract changes when they affect IPC or offline synchronization.

Do not duplicate validation rules across Prisma schema, Nest DTOs, and renderer forms without stating which one is authoritative.

## Architectural Defaults

- Keep the backend stateless where possible.
- Use transactions for multi-step writes that must succeed together.
- Capture audit events close to the write boundary.
- Treat reports and exports as dedicated read models when queries become heavy.
- Introduce CQRS only when read and write models genuinely diverge.

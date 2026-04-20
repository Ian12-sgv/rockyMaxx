---
name: build-gestion-stack
description: Architect, design, and implement a desktop-first sistema de gestion with PostgreSQL, NestJS, Prisma, TypeScript, and Electron. Use when Codex needs to define bounded contexts, data models, migrations, backend APIs, IPC contracts, desktop workflows, security, testing, or delivery standards for an ERP-style or operational backoffice product.
---

# Build Gestion Stack

## Overview

Use this skill to keep a management system coherent across database, backend, and Electron desktop layers. Favor explicit contracts, modular boundaries, auditability, and operator-oriented workflows over quick CRUD sprawl.

## Entry Checklist

1. Identify the business capability, primary actors, and critical workflows.
2. Decide whether the work belongs to an existing bounded context or requires a new module.
3. Confirm the source of truth for data, permissions, audit events, and reports.
4. Read only the references needed for the current task:
   - `references/stack-blueprint.md` for workspace shape, module boundaries, and recommended libraries.
   - `references/data-and-backend.md` for PostgreSQL, Prisma, NestJS, transactions, validation, and API patterns.
   - `references/electron-and-ui.md` for Electron process boundaries, IPC contracts, renderer architecture, and dense backoffice UX.
   - `references/delivery-gates.md` for testing, security, releases, and observability.
   - `references/agent-playbook.md` and `agents/roster.yaml` when splitting work across subagents.

## Default Architecture

- Prefer a modular monolith before microservices.
- Shape the workspace around `apps/api`, `apps/desktop`, `packages/contracts`, `packages/ui`, and shared config or tooling packages.
- Model business capabilities as modules with clear inbound contracts, application services, and persistence adapters.
- Keep PostgreSQL as the system of record. Do not let Electron or the renderer query the database directly.
- Keep cross-layer contracts explicit. Prefer shared schemas or DTO packages over duplicated ad hoc types.
- Make audit logging, RBAC, and error taxonomy first-class from the start.

## Working Rules

- Write or update an ADR before changing repo shape, tenancy model, authentication strategy, IPC boundaries, or reporting architecture. Reuse `assets/templates/adr-template.md`.
- Keep ownership explicit. Use `agents/roster.yaml` to assign disjoint write scopes.
- Prefer schema constraints and transactions over "we will validate in the UI".
- Keep preload small and intentional. Expose narrow IPC methods, never raw Node access.
- Optimize for operator throughput: keyboard flow, batch actions, predictable forms, recoverable failures, print or export paths, and searchable records.
- Standardize `lint`, `typecheck`, `test`, `e2e`, `build`, and packaging commands before the codebase grows.

## Recommended Delivery Sequence

1. Capture the domain, success metrics, and operational constraints.
2. Define bounded contexts, module boundaries, and critical ADRs.
3. Design Prisma models, migrations, indexes, seeds, and audit strategy.
4. Implement NestJS modules and shared contracts.
5. Implement Electron shell, preload bridge, and renderer workflows.
6. Add integration tests, end-to-end coverage, release automation, and observability.
7. Revisit hotspots: permissions, long-running jobs, imports or exports, printing, and reports.

## Output Expectations

When using this skill for a concrete task, always state:

- the affected bounded context or module,
- the contract changes,
- the persistence impact,
- the desktop or UI impact,
- the test plan,
- the migration or rollout risk.

## Resources

- `references/stack-blueprint.md`
- `references/data-and-backend.md`
- `references/electron-and-ui.md`
- `references/delivery-gates.md`
- `references/agent-playbook.md`
- `agents/roster.yaml`
- `assets/templates/adr-template.md`
- `assets/templates/feature-spec-template.md`

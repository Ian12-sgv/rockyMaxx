# Data And Backend

## PostgreSQL And Prisma

Model the schema around business invariants, not screen layouts.

Prefer:

- explicit foreign keys,
- unique constraints for natural business rules,
- composite indexes for frequent filters,
- enums or reference tables only when the lifecycle is clear,
- soft delete only for records that truly require recovery or audit review.

Avoid:

- nullable fields that hide missing process decisions,
- unbounded JSON columns for core transactional data,
- UI-only ordering fields as a substitute for domain concepts,
- hidden cascade behaviors that operators cannot reason about.

## Migration Rules

- Write additive migrations first when rollout risk is non-trivial.
- Backfill data explicitly before making columns required.
- Separate destructive cleanup from feature delivery when possible.
- Document lock risk and rollback assumptions in the migration note or ADR.

For important schema changes, state:

- affected tables,
- expected row counts,
- index impact,
- transaction duration risk,
- compatibility window with old clients.

## Transaction Strategy

Use a transaction when a business operation changes multiple records that must remain consistent together, such as:

- invoice plus invoice lines,
- stock movement plus inventory balance,
- payment plus ledger movement,
- user role change plus permission grants.

Do not wrap long-running jobs, external calls, or file operations inside database transactions.

## NestJS Design

Prefer one module per bounded context. Inside each module:

- controllers adapt transport to application commands or queries,
- services orchestrate business use cases,
- repositories encapsulate Prisma access,
- mappers isolate persistence shape from API shape.

Keep controller methods focused on:

- auth and authorization,
- request validation,
- calling an application service,
- returning a normalized response or domain-specific error.

## Validation Strategy

Pick one dominant rule:

- prefer shared `zod` schemas for contracts reused in Electron and backend,
- prefer Nest DTOs with `class-validator` when the schema is API-local.

Regardless of transport validation, enforce critical rules again in the write path if breaking them would corrupt the system.

## Error And Audit Rules

- Define a stable error taxonomy by module.
- Return actionable operator-facing messages for recoverable failures.
- Log structured context for technical diagnosis without leaking secrets.
- Write audit entries for permission changes, critical financial or stock movements, record approvals, cancellations, and destructive actions.

## Reporting Strategy

Operational reports often become a hidden architecture constraint. Decide early:

- whether reports read from transactional tables or dedicated projections,
- how date ranges and time zones are normalized,
- which exports must be reproducible later,
- how large result sets are paginated or streamed.

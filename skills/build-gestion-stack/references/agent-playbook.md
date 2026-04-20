# Agent Playbook

## Read This Before Spawning Subagents

Use subagents only after the module boundary and write scope are clear.

Read `agents/roster.yaml` to choose the agent. Keep write scopes disjoint whenever possible. Do not let multiple agents edit the same feature slice without a clear owner.

## Recommended Handoff Order

1. `solution-architect`
2. `domain-modeler`
3. `security-compliance-engineer`
4. `postgres-prisma-engineer`
5. `nest-api-engineer`
6. `electron-desktop-engineer`
7. `ui-workflow-engineer`
8. `qa-automation-engineer`
9. `devex-release-engineer`

## Required Handoff Artifacts

Each agent should return:

- decision note or ADR update,
- touched paths,
- contract changes,
- migration or data impact,
- open risks and assumptions,
- recommended next owner.

## Prompt Pattern

Use prompts shaped like this:

`Use $build-gestion-stack at /absolute/path/to/skills/build-gestion-stack to <goal>. Own only <paths>. Return decisions, touched files, risks, and next handoff.`

Example:

`Use $build-gestion-stack at /absolute/path/to/skills/build-gestion-stack to design the inventory and stock-movement module for a desktop-first management system. Own only docs/architecture and packages/contracts. Return module boundaries, invariants, risks, and the next recommended agent.`

## Merge Guidance

Safe role merges on small teams:

- `electron-desktop-engineer` plus `ui-workflow-engineer`
- `qa-automation-engineer` plus `devex-release-engineer`

Unsafe merges for medium or long-lived projects:

- `postgres-prisma-engineer` plus `ui-workflow-engineer`
- `solution-architect` as a permanent feature implementer
- omitting `security-compliance-engineer`

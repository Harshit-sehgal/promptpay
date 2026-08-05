---
name: Migration task
about: Plan and review one database schema or data migration
 title: '[MIGRATION] '
labels: ''
assignees: ''
---

## Work package

- Blueprint ID: WL-
- Release: 0.x
- Migration name / directory:
- Related issue or PR:

## Objective

<!-- Describe the one schema or data change and why it is needed. -->

## Scope and compatibility

- [ ] Additive or explicitly reviewed breaking change
- [ ] Existing application version remains compatible during rollout
- [ ] No production-money behavior changes, or the financial impact is explicitly reviewed
- [ ] No production secrets, prompts, source, commands, or terminal output are introduced

## Database impact

- Tables / columns / indexes / constraints:
- Expected row count or backfill size:
- Lock and runtime estimate:
- Read/write impact:
- Required indexes or query changes:

## Rollout plan

1. Pre-deploy backup / evidence:
2. Migration deployment order:
3. Application rollout order:
4. Post-deploy verification:
5. Cleanup or follow-up migration:

## Validation

- [ ] Prisma schema validates and client is generated
- [ ] Migration SQL is reviewed
- [ ] Fresh-database migration succeeds
- [ ] Upgrade migration succeeds on a representative database
- [ ] Migration status reports up to date
- [ ] Schema drift check passes
- [ ] Unit / integration tests cover the changed behavior
- [ ] Rollback or forward-fix plan is documented

Commands and results:

## Safety and rollback

- Backup / restore evidence:
- Rollback strategy (prefer a forward fix for applied migrations):
- Data-loss or lock-risk assessment:
- Kill switch / operational containment if applicable:

## Evidence

- Build SHA:
- Environment / database identifier:
- Migration status output:
- Drift-check output:
- Test or release-evidence artifact:

## Blueprint linkage

- Work package / issue:
- Release:

## Change summary

## Safety checklist

- [ ] One independently reviewable change
- [ ] Existing production-money behavior is unchanged
- [ ] New telemetry path has no ad, ledger, payout, or settlement side effect
- [ ] Raw prompts, responses, source, commands, terminal output, paths, and secrets are not persisted
- [ ] Environment/sandbox guards are fail-closed
- [ ] Migration is additive, reversible, and reviewed (or no migration)
- [ ] Product copy is mode-aware where applicable

## Verification

- [ ] Typecheck
- [ ] Lint
- [ ] Focused tests
- [ ] Full relevant workspace tests
- [ ] Build
- [ ] Migration/drift check
- [ ] Release evidence artifact updated

Commands/results:

## Rollback

<!-- Describe the smallest safe rollback, including migration/config implications. -->

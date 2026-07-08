# Contributing to WaitLayer

Thanks for contributing! This short guide covers the conventions the project
expects before a PR is merged.

## Commit messages (Conventional Commits)

We follow [Conventional Commits](https://www.conventionalcommits.org/). A good
commit message looks like:

```
feat(api): add rate-limit headers to auth responses

Closes #53
```

A optional local template is provided at `.gitmessage`. Enable it with:

```sh
git config commit.template .gitmessage
```

### Types

| Type       | Meaning                                            |
| ---------- | -------------------------------------------------- |
| `feat`     | New feature                                        |
| `fix`      | Bug fix                                            |
| `docs`     | Documentation only                                 |
| `style`    | Formatting (prettier/eslint --fix), no logic       |
| `refactor` | Code change that neither fixes nor adds a feature  |
| `perf`     | Performance improvement                            |
| `test`     | Adding or updating tests                           |
| `build`    | Build / Docker / dependency changes                |
| `ci`       | CI / GitHub Actions / Makefile                     |
| `chore`    | Misc (no prod code, no tests)                      |
| `revert`   | Revert a previous commit                           |

Prefix a breaking change with `!` after the scope or add a `BREAKING CHANGE:`
footer.

## Pre-commit hooks

[Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged)
run `eslint --fix` and `prettier --write` on staged files automatically once
you've installed dependencies (`pnpm install`, which sets up the hook via the
`prepare` script). Do not bypass them with `--no-verify` except in emergencies.

## Before opening a PR

- `pnpm run typecheck` passes
- `pnpm run lint` passes
- `pnpm run test` passes (needs `DATABASE_URL` + `REDIS_URL` + `JWT_SECRET`)
- `pnpm run build` succeeds
- New env vars are documented in `docs/ENV_REFERENCE.md`
- DB schema changes include a migration (`pnpm db:migrate`) — never edit the
  shadow/schema by hand

See `docs/CODE_REVIEW_CHECKLIST.md` for what reviewers look for.

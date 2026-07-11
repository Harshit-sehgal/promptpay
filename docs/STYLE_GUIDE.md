# Style Guide

Beyond ESLint/Prettier (enforced via the pre-commit hook), these are the
conventions the codebase follows.

## Formatting

- Enforced by Prettier (`.prettierrc`): single quotes, semicolons, 100 col,
  2-space indent, trailing commas.
- Run `pnpm run lint` (eslint) and let the hook run `prettier --write`.

## Imports (enforced by `simple-import-sort`)

Order within a file:

1. Side-effect imports (`import 'x'`).
2. External / builtin (`node:fs`, `express`, `@nestjs/...`) — `node:` builtins
   first.
3. Workspace packages (`@waitlayer/*`).
4. Relative imports (`./`, `../`), parent `../` before child `./`.

Example:

```ts
import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@waitlayer/config';

import { LedgerRepository } from './ledger.repository';
import { computeSplit } from '../split';
```

## Naming

- `PascalCase` for classes, interfaces, DTOs, enums, Nest modules/controllers.
- `camelCase` for variables, functions, methods, properties.
- `UPPER_SNAKE_CASE` for environment variables and true constants.
- Files: `kebab-case.ts` for most modules; `*.service.ts`, `*.controller.ts`,
  `*.guard.ts`, `*.module.ts`, `*.spec.ts`, `*.dto.ts` suffixes.

## Types & nullability

- Prefer explicit types at module boundaries (function signatures, DTOs).
- Avoid `any` (eslint warns). Use `unknown` and narrow.
- Use `readonly` for immutable config objects and DTO shapes where practical.

## Errors

- Throw Nest `HttpException` subclasses at boundaries; do not leak internals.
- Use the shared error envelope (consistent shape — see API spec). Never log
  secrets/tokens/PII.

## Async

- `async`/`await`; avoid raw promise chains in app code.
- Await all promises; no floating promises in request handlers or cron loops.
- DB consistency across multiple writes uses Prisma transactions (ledger,
  payout, referral).

## Money & IDs

- Money is stored as integer **minor units** + currency code. Never floats.
- Primary keys are UUIDs. Sensitive external ids are hashed/encrypted.

## Tests

- Colocate `*.spec.ts` next to source. Cover happy + failure paths.
- Integration specs boot the real app against a migrated test DB; do not mock
  the DB in contract/e2e tests.

## Commits

- Conventional Commits — see `docs/CONTRIBUTING.md`.

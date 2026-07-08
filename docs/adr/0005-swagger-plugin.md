# ADR 0005: NestJS Swagger Compiler Plugin for API Documentation

- **Status:** Accepted (2026)
- **Deciders:** WaitLayer engineering

## Context

The API had a real Swagger UI mount but zero decorators, so the interactive
docs were empty. Hand-annotating ~19 DTOs and 14 controllers with `@ApiProperty`
/ `@ApiOperation` would be high-effort and would drift from the class-validator
rules already on each field.

## Decision

Enable the **`@nestjs/swagger` compiler plugin** in `apps/api/nest-cli.json`
with `classValidatorShim: true` and `introspectComments: true`. The plugin
auto-derives request/response schemas and descriptions from class-validator
decorators and JSDoc at build time. Controllers additionally carry `@ApiTags`
for grouping.

## Consequences

- **Positive:** API docs stay in sync with validation rules for free; OpenAPI
  contract is generated consistently; low maintenance.
- **Negative:** Docs are only populated in `nest build` output (tsc typecheck
  does not run the plugin), so the running service — not the typecheck — is the
  source of truth for the published contract. Mitigated by contract tests.

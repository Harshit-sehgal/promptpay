# Public-repository exposure audit

> Audit date: 2026-08-18
>
> This report intentionally contains no credential values, private keys, tokens,
> webhook secrets, passwords, or private hostnames. It records categories and
> remediation state only.

## Scope and evidence

The audit covers the current tree and reachable Git history, with these
repository-local checks:

- `git ls-files` for tracked environment, key, credential, and secret-like paths;
- Git history path inspection for exact `.env` files and key/credential-shaped
  filenames;
- `node scripts/scan-build-secrets.mjs` for compiled/build artifacts;
- the repository's full-history gitleaks configuration and exact fingerprint
  baseline (`.gitleaks.toml`, `.gitleaksignore`);
- current remote URLs, checked for embedded credentials.

The current build-artifact scan passes. The local environment does not have the
`gitleaks` executable, so a new full-history scan was **not** represented as
completed by this audit. The latest repository-recorded full-history scan is the
CI run whose 26 exact benign fingerprints are recorded in `.gitleaksignore`.
CI remains the authoritative full-history secret gate.

## Findings

| Category                                       | Current-tree result                                                                                                                      | History/result                                                                                                                                      | Required action                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| API, Stripe, and Dodo credentials              | No credential values are reported here; runtime values are gitignored/operator-supplied.                                                 | The gitleaks baseline records only reviewed fixtures/examples; Dodo live credentials are documented as operator-supplied and must not be committed. | Rotate any credential that was ever used outside its intended scope; verify provider dashboards directly.                        |
| GitHub credentials                             | No value is present in this report or current remote URL.                                                                                | A previously exposed GitHub credential is recorded in `AGENTS.md` as an operator-owned rotation item.                                               | **Rotate/revoke in GitHub now**; do not rely on history deletion alone.                                                          |
| Vercel token/project credentials               | No token is tracked or embedded in the current GitHub remote.                                                                            | Vercel deployment diagnostics remain blocked by missing local Vercel authentication.                                                                | Authenticate Vercel, inspect failed deployment logs, and revoke any historical token if the Vercel account reports one.          |
| JWT private keys/signing keys                  | No production key material is tracked; `*.pem` is ignored. Test fixtures and examples are covered by exact benign gitleaks fingerprints. | Full-history baseline entries are limited to fixture/example/test values and are not path-wide suppressions.                                        | Keep generated production keys in the secret manager only; rotate if any real deployment key was ever committed.                 |
| OAuth, database, Redis, and webhook secrets    | No exact `.env` path is tracked; `.env`, local env variants, PEMs, and credential JSON files are ignored.                                | Example/configuration references are scanned by CI; no live value is reproduced here.                                                               | Verify provider consoles and deployment secret stores; rotate any value with uncertain provenance.                               |
| Private domains/IPs and infrastructure details | Public repository documentation contains intentionally public service/project references and operational examples.                       | No private credential value is included in this report.                                                                                             | Review deployment-specific domains and IPs before publishing further operational docs; do not treat obscurity as access control. |
| Build artifacts                                | `node scripts/scan-build-secrets.mjs` passes: no signing secrets detected in scanned artifacts.                                          | Runtime-image and CI secret gates are separate and must remain enabled.                                                                             | Re-run after any build/deployment configuration change.                                                                          |

## Baseline interpretation

`.gitleaksignore` contains exact `commit:path:rule:line` fingerprints, not path
patterns. `.gitleaks.toml` extends the default rules and scopes its one
allowlist entry to the baseline file itself. This preserves detection for a new
real secret in a file that has a historical benign finding.

The baseline is evidence about the findings that were reviewed; it is not proof
that a credential is safe to keep. A value that was ever real must be revoked
at the provider, even if it no longer appears in the tree.

## Operator closure checklist

- [ ] Revoke and replace the previously exposed GitHub credential.
- [ ] Authenticate Vercel and inspect all three failed preview deployments.
- [ ] Verify GitHub, Vercel, Dodo, OAuth, database, Redis, and webhook secret
      stores contain no stale or duplicated credentials.
- [ ] Run a fresh full-history gitleaks scan from an environment with gitleaks
      installed; compare only sanitized finding counts/fingerprints, never paste
      secret values into an issue or report.
- [ ] Preserve the existing exact baseline only for findings re-verified as
      benign; do not add a broad path allowlist.
- [ ] Re-run build-artifact scanning and the full release gates after any
      credential/configuration change.

## Status

This audit closes the **reporting/code** portion of the public-exposure task.
It does not close credential rotation, Vercel authentication, repository
visibility, or production secret verification; those require the operator with
access to the external accounts.

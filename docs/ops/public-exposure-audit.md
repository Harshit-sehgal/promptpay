# Public-repository exposure audit

> Audit date: 2026-08-19
>
> This report intentionally contains no credential values, private keys, tokens,
> webhook secrets, passwords, or private hostnames. It records categories and
> remediation state only.
>
> **Verification-status marker — split evidence.** The build-artifact scan was
> rerun against the current tree on 2026-08-19 and passes. The required CI
> security job also passed its current-HEAD full-history gitleaks scan in run
> `32262946463`. The redacted local-container result below is retained as a
> historical supplementary snapshot at `407b001`; gitleaks is unavailable in
> the current local environment.

## Scope and evidence

The audit covers the current tree with repository-local checks and the required
CI security scan, plus a dated supplementary full-history gitleaks snapshot:

- `git ls-files` for tracked environment, key, credential, and secret-like paths;
- Git history path inspection for exact `.env` files and key/credential-shaped
  filenames;
- `node scripts/scan-build-secrets.mjs` for compiled/build artifacts;
- the repository's full-history gitleaks configuration and exact fingerprint
  baseline (`.gitleaks.toml`, `.gitleaksignore`);
- current remote URLs, checked for embedded credentials.

The current build-artifact scan passes. The required GitHub security job passed
the repository's current-HEAD full-history gitleaks action in CI run
`32262946463`; that is the current scan evidence and no new baseline entries
were added. Separately, an independent redacted gitleaks v8.24.3 scan was run
from a read-only container against snapshot commit `407b001`, using the same
`--no-merges --first-parent` history scope. It scanned 468 first-parent commits
and reported no leaks; this remains historical supplementary evidence.

## Findings

| Category                                       | Current-tree result                                                                                                                                                                                                                        | History/result                                                                                                                                      | Required action                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API, Stripe, and Dodo credentials              | No credential values are reported here; runtime values are gitignored/operator-supplied.                                                                                                                                                   | The gitleaks baseline records only reviewed fixtures/examples; Dodo live credentials are documented as operator-supplied and must not be committed. | Rotate any credential that was ever used outside its intended scope; verify provider dashboards directly.                                                                                    |
| GitHub credentials                             | No value is present in this report or current remote URL.                                                                                                                                                                                  | A previously exposed GitHub credential is recorded in `AGENTS.md` as an operator-owned rotation item.                                               | **Rotate/revoke in GitHub now**; do not rely on history deletion alone.                                                                                                                      |
| Vercel token/project credentials               | No token is tracked or embedded in the current GitHub remote. Browser-authenticated project access is verified; the Preview is ready and `waitlayer.com`/`www.waitlayer.com` are attached to `promptpay` but remain Verification Required. | No credential value is reported here; historical token rotation remains operator-owned.                                                             | Revoke any historical token if the Vercel account reports one; publish Vercel's current DNS verification records at the registrar and keep production access and visibility review separate. |
| JWT private keys/signing keys                  | No production key material is tracked; `*.pem` is ignored. Test fixtures and examples are covered by exact benign gitleaks fingerprints.                                                                                                   | Full-history baseline entries are limited to fixture/example/test values and are not path-wide suppressions.                                        | Keep generated production keys in the secret manager only; rotate if any real deployment key was ever committed.                                                                             |
| OAuth, database, Redis, and webhook secrets    | No exact `.env` path is tracked; `.env`, local env variants, PEMs, and credential JSON files are ignored.                                                                                                                                  | Example/configuration references are scanned by CI; no live value is reproduced here.                                                               | Verify provider consoles and deployment secret stores; rotate any value with uncertain provenance.                                                                                           |
| Private domains/IPs and infrastructure details | Public repository documentation contains intentionally public service/project references and operational examples.                                                                                                                         | No private credential value is included in this report.                                                                                             | Review deployment-specific domains and IPs before publishing further operational docs; do not treat obscurity as access control.                                                             |
| Build artifacts                                | `node scripts/scan-build-secrets.mjs` passes: no signing secrets detected in scanned artifacts.                                                                                                                                            | Runtime-image and CI secret gates are separate and must remain enabled.                                                                             | Re-run after any build/deployment configuration change.                                                                                                                                      |

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
- [x] Authenticate Vercel in the browser and inspect the current failed branch
      deployment; after the configuration/source fix, Preview deployment
      `76PS12GyxL2bZ69XNwccfMxHndiL` is Ready.
- [x] Attach `waitlayer.com` and `www.waitlayer.com` to the current Vercel
      `promptpay` project; Vercel reports that DNS verification is still
      required because the domains are linked to another Vercel account.
- [ ] Publish the Vercel-provided `_vercel` TXT records and current A/CNAME
      records at the registrar, then recheck the rendered application routes.
- [ ] Verify GitHub, Vercel, Dodo, OAuth, database, Redis, and webhook secret
      stores contain no stale or duplicated credentials.
- [x] Run the required current-HEAD full-history gitleaks scan in CI run
      `32262946463`; it reported no leaks and no new baseline entries.
- [x] Run a redacted supplementary full-history gitleaks scan against snapshot `407b001` from
      an environment with gitleaks installed; the v8.24.3 first-parent scan
      covered 468 commits and reported no leaks. No secret values were recorded.
- [x] Preserve the existing exact baseline only for findings re-verified as
      benign; no new entries or broad path allowlists were added.
- [ ] Re-run build-artifact scanning and the full release gates after any
      credential/configuration change.

## Status

This audit closes the **reporting/code/current-CI-scan and current Vercel
Preview diagnosis** portions of the public-exposure task. It does not close
credential rotation, repository visibility, production secret verification,
API DNS/infrastructure, or production deployment; those require the operator
with access to the external accounts and infrastructure.

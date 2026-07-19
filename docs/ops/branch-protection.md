# Branch Protection (P1.21 / P0.5)

The repository is hosted on GitLab (`git@gitlab.com:promptpay1/promptpay.git`).
Branch protection is configured in the GitLab UI, not via a file. Apply these
settings to `main` (and any release branches):

## Required protections

- **Protected branch:** `main` is protected.
- **No force push:** disable "Allowed to force push".
- **No branch deletion:** disable "Allowed to delete".
- **Require merge request (PR):** pushes to `main` are blocked; all changes go
  through a merge request.
- **Required CI checks:** the MR pipeline must pass before merge. Required
  statuses:
  - `build-and-test`
  - `package-clients`
  - `docker-build`
  - `backup-restore`
  - `security`
  - `verify-audit-claims`
- **Approvals:** require ≥ 1 approval from a CODEOWNERS owner of the touched
  paths. Enable **"Prevent approval by author"** and **"Require new approval
  after new commits"** so stale approvals cannot merge stale code.
- **CODEOWNERS:** enable "Require approval from code owners" so money-critical
  and auth paths cannot merge without the right reviewer.
- **Stale approval dismissal:** enable so an approve from before a force-push
  (or a significant rebase) is invalidated.

## Supply-chain hygiene

- **Pinned GitHub Action SHAs:** every `uses:` in `.github/workflows/ci.yml`
  uses a full commit SHA (with a `# vN` comment). New actions added for
  security scanning (CodeQL, gitleaks, trivy, sbom-action) currently use
  version tags for expediency — pin them to full SHAs before relying on the
  blocking pipeline.
- **Dependency updates:** require human review of dependency-bump MRs; do not
  auto-merge large upgrades. `pnpm audit` runs in CI and fails the
  `build-and-test` job on moderate-and-above advisories.

## Notes

- This repository has no `gh` CLI / GitHub environment in the build sandbox, so
  the protections above are documented here and must be applied by an operator
  in the GitLab project settings. The CI _configuration_ already matches every
  required job from P0.5; the "verified green run" is produced by the GitLab
  pipeline against the exact commit.

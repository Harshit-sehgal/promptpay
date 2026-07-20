# Branch Protection (P1.21 / P0.5)

The repository is hosted on GitHub (`https://github.com/Harshit-sehgal/promptpay.git`); the product is branded **WaitLayer** while the repository/remote retains the `promptpay` name (see "Naming" below).
Branch protection is configured in GitHub repo **Settings → Branches**, not via
a file. Apply these settings to `main` (and any release branches):

## Required protections

- **Protected branch:** `main` is protected.
- **No force push:** disable "Allowed to force push".
- **No branch deletion:** disable "Allowed to delete".
- **Require merge request (PR):** pushes to `main` are blocked; all changes go
  through a merge request.
- **Required CI checks:** the GitHub Actions workflow must pass before merge.
  Required statuses (job names in `.github/workflows/ci.yml`):
  - `typecheck`
  - `lint`
  - `build`
  - `test`
  - `e2e`
  - `package-clients`
  - `docker-build`
  - `backup-restore`
  - `verify-audit-claims`
  - `security`
- **Approvals:** require ≥ 1 approval from a CODEOWNERS owner of the touched
  paths. Enable **"Prevent approval by author"** and **"Require new approval
  after new commits"** so stale approvals cannot merge stale code.
- **CODEOWNERS:** enable "Require approval from code owners" so money-critical
  and auth paths cannot merge without the right reviewer.
- **Stale approval dismissal:** enable so an approve from before a force-push
  (or a significant rebase) is invalidated.

## Supply-chain hygiene

- **Pinned GitHub Action SHAs:** every `uses:` in `.github/workflows/ci.yml`
  (including the security-scanning actions CodeQL, gitleaks, trivy, and
  sbom-action) already uses a full commit SHA with a `# vN` comment. Keep all
  new actions pinned to full SHAs.
- **Dependency updates:** require human review of dependency-bump MRs; do not
  auto-merge large upgrades. `pnpm audit` runs in CI and fails the
  `build-and-test` job on moderate-and-above advisories.

## Notes

- Branch protection is a **GitHub repository setting** and cannot be applied from
  code; an operator must enable it in GitHub repo Settings using the checklist
  above. The CI _configuration_ already defines every required job from
  P0.5/P1.21 (see `.github/workflows/ci.yml`); the "verified green run" is
  produced by the GitHub Actions workflow against the exact commit.
- **Naming (P2.6):** the product, homepage, package names, API defaults and
  domains are intentionally **WaitLayer**. The repository directory and Git
  remote retain **promptpay** (`Harshit-sehgal/promptpay`). This divergence is a
  known, pending product/branding decision — not a defect. Rename only via a
  deliberate, repo-wide change (package names, Docker image names, env vars,
  domains) tracked as its own task; do not partially rename.

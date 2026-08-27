# Branch Protection (P1.21 / P0.5)

The repository is hosted on GitHub (`https://github.com/Harshit-sehgal/promptpay.git`); the product is branded **Ateva** while the repository/remote retains the `promptpay` name (see "Naming" below).
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
- **Approvals:** require ≥ 1 independent approval. Enable **"Prevent approval
  by author"** so the PR author cannot satisfy the requirement. The current
  policy does not separately require a new approval after every commit
  (`require_last_push_approval=false`); revisit that setting if the review
  policy changes.
- **CODEOWNERS:** the repository currently has only one collaborator, who is
  also the PR author. `require_code_owner_reviews` is therefore disabled;
  re-enable it when a second qualified code-owner reviewer is added.
- **Stale approval dismissal:** enabled, so an approval from before a force-push
  (or a significant rebase) is invalidated.

### Current `main` verification (2026-08-26)

The live GitHub branch-protection setting has been checked after the operator
choice to drop the code-owner-only requirement: admins remain enforced, one
independent approval is required, stale approvals are dismissed, and
`require_code_owner_reviews` is false. This is a GitHub setting, not a
repository file; verify it again after adding a collaborator or changing the
review policy.

## Supply-chain hygiene

- **Pinned GitHub Action SHAs:** every `uses:` in `.github/workflows/ci.yml`
  (including the security-scanning actions CodeQL, gitleaks, trivy, and
  sbom-action) already uses a full commit SHA with a `# vN` comment. Keep all
  new actions pinned to full SHAs.
- **Dependency updates:** require human review of dependency-bump MRs; do not
  auto-merge large upgrades. CI hard-fails on moderate-and-above production
  advisories and has a narrow, reviewed quarantine for the one known
  dev-only Nest CLI advisory; any new or differently scoped advisory fails.
- **Image signing:** the staging release gate signs the immutable API and web
  digests with GitHub OIDC using Cosign, then verifies both signatures before
  production promotion. Keep the workflow's `id-token: write` permission and
  the pinned `sigstore/cosign-installer` SHA. Do not replace digest promotion
  with mutable tags or disable signature verification to accommodate a private
  registry.

## Notes

- Branch protection is a **GitHub repository setting** and cannot be applied from
  code; an operator must enable it in GitHub repo Settings using the checklist
  above. The CI _configuration_ already defines every required job from
  P0.5/P1.21 (see `.github/workflows/ci.yml`); the "verified green run" is
  produced by the GitHub Actions workflow against the exact commit.
- **Naming (P2.6):** the product, homepage, package names, API defaults and
  domains are intentionally **Ateva**. The repository directory and Git
  remote retain **promptpay** (`Harshit-sehgal/promptpay`). This divergence is a
  known, pending product/branding decision — not a defect. Rename only via a
  deliberate, repo-wide change (package names, Docker image names, env vars,
  domains) tracked as its own task; do not partially rename.

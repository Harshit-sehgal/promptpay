# Client Release Runbook

This runbook covers the distributed WaitLayer clients: `waitlayer-cli` on npm and
the `waitlayer-vscode` VS Code extension.

## Artifacts

- CLI release workflow: `.github/workflows/publish-cli.yml`
  - Packages `apps/cli` into `waitlayer-cli-*.tgz`.
  - Smoke-installs the tarball and runs `waitlayer --version` and
    `waitlayer --help` with `WAITLAYER_API_URL=https://api.waitlayer.com/api/v1`.
  - Uploads the tarball as the `waitlayer-cli-package` workflow artifact.
- VS Code release workflow: `.github/workflows/publish-vscode.yml`
  - Packages `apps/vscode-extension` into `waitlayer-vscode.vsix`.
  - Checks the VSIX metadata keeps `waitlayer.apiUrl` defaulted to
    `https://api.waitlayer.com/api/v1`.
  - Uploads the VSIX as the `waitlayer-vscode-vsix` workflow artifact.

Release-published events build and upload artifacts but do not publish to npm or
Marketplace automatically. Real publication is a manual `workflow_dispatch` run
with `publish=true`, guarded by the `npm-publish` or `vscode-marketplace`
GitHub environment.

## Publish

1. Verify CI is green for the release commit.
2. Create or publish the GitHub release to generate reviewable artifacts.
3. Download and smoke-test the uploaded artifact locally if needed.
4. Re-run the relevant publish workflow manually with `publish=true`.
5. Confirm the package appears in npm or Visual Studio Marketplace.

Required secrets:

- `NPM_TOKEN` for npm publication.
- `VSCE_PAT` for Visual Studio Marketplace publication.

## Rollback

- CLI: publish a corrected patch version. npm package versions are immutable, so
  do not attempt to replace an already-published tarball.
- VS Code: publish a corrected patch version or unpublish the Marketplace
  version only if the Marketplace policy and customer impact justify it.
- For both clients, leave the previous workflow artifacts attached for audit and
  incident review.

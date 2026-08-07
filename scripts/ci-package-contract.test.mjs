import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function assertNoPrivateRuntimeDependencies(pkg) {
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      assert.equal(name.startsWith('@waitlayer/'), false, `${section} contains private ${name}`);
      assert.equal(
        String(version).startsWith('workspace:'),
        false,
        `${section} contains workspace protocol ${name}@${version}`,
      );
    }
  }
}

test('CI blocks on production browser E2E and recovered Playwright flakes', () => {
  const workflow = read('.github/workflows/ci.yml');
  const productionJob = workflow.match(/\n  e2e-production:\n([\s\S]*?)\n  package-clients:/)?.[1];
  assert.ok(productionJob, 'missing blocking e2e-production job');
  assert.match(productionJob, /5433:5432/);
  assert.match(productionJob, /E2E_PROD_REDIS_DB: '12'/);
  assert.match(productionJob, /run: pnpm e2e:production/);
  assert.doesNotMatch(productionJob, /continue-on-error:\s*true/);

  const playwright = read('apps/web/playwright.config.ts');
  assert.match(playwright, /failOnFlakyTests:\s*!!process\.env\.CI/);
});

test('production preflight cannot be blanket-suppressed', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.doesNotMatch(workflow, /deploy-preflight[^\n]*\|\|\s*true/);
  assert.match(workflow, /PREFLIGHT_STATUS=\$\?/);
  assert.match(workflow, /EXPECTED_FAILURES=.*administrator-mfa compose-override/);
  assert.match(workflow, /ACTUAL_FAILURES.*!=.*EXPECTED_FAILURES/);
});

test('release gates build CLI fixtures before running scenario tests without file-level races', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(
    pkg.scripts['test:release-gates'],
    /^pnpm --filter "waitlayer-cli\.\.\." build && node --test --test-concurrency=1 /,
  );
});

test('CLI publication is gated by full CI, tag consistency, and isolated install smoke', () => {
  const workflow = read('.github/workflows/publish-cli.yml');
  assert.match(workflow, /quality-gate:\n\s+uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(workflow, /package-cli:\n\s+needs: quality-gate/);
  assert.match(workflow, /RELEASE_TAG.*v\$PACKAGE_VERSION/);
  assert.match(workflow, /pnpm --filter "waitlayer-cli\.\.\." build/);
  assert.match(workflow, /npm install --prefix "\$CLI_INSTALL_ROOT"/);
});

test('packed CLI runs outside the monorepo without private runtime packages', () => {
  const manifest = JSON.parse(read('apps/cli/package.json'));
  assertNoPrivateRuntimeDependencies(manifest);

  run('pnpm', ['--filter', 'waitlayer-cli', 'pack:check']);

  const work = mkdtempSync(join(tmpdir(), 'waitlayer-cli-package-test-'));
  try {
    run('pnpm', ['--filter', 'waitlayer-cli', 'pack', '--pack-destination', work]);
    const tarballs = readdirSync(work).filter((name) => name.endsWith('.tgz'));
    assert.equal(tarballs.length, 1, 'expected exactly one packed CLI tarball');

    const extractRoot = join(work, 'extract');
    mkdirSync(extractRoot);
    run('tar', ['-xzf', join(work, tarballs[0]), '-C', extractRoot]);

    const packageRoot = join(extractRoot, 'package');
    const packedManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    assertNoPrivateRuntimeDependencies(packedManifest);
    assert.deepEqual(readdirSync(join(packageRoot, 'dist')), ['index.js']);

    const cli = join(packageRoot, 'dist', 'index.js');
    const isolatedEnv = {
      ...process.env,
      NODE_PATH: '',
      WAITLAYER_API_URL: 'https://api.waitlayer.com/api/v1',
    };
    const version = run(process.execPath, [cli, '--version'], {
      cwd: work,
      env: isolatedEnv,
    });
    assert.equal(version.stdout.trim(), packedManifest.version);
    const help = run(process.execPath, [cli, '--help'], { cwd: work, env: isolatedEnv });
    assert.match(help.stdout, /Usage: waitlayer/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

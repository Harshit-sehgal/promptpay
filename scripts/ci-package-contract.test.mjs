import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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

test('release gates build every fixture they execute, before running scenario tests', () => {
  const pkg = JSON.parse(read('package.json'));
  const gates = pkg.scripts['test:release-gates'];
  // The prebuild must cover BOTH consumer boundaries the scenario fixtures
  // load, and must use the dependency-aware `...` suffix — `pnpm --filter <pkg>
  // build` does NOT build workspace dependencies.
  //
  // 11 scenario runners import the COMPILED API (`apps/api/dist/...`). The
  // prebuild used to cover only the CLI, so on a clean checkout the whole
  // release-gate suite died with ERR_MODULE_NOT_FOUND. It never reproduced
  // locally because an earlier `pnpm build` had left `dist/` behind.
  assert.match(
    gates,
    /^pnpm --filter "waitlayer-cli\.\.\." --filter "waitlayer-api\.\.\." build && node --test --test-concurrency=1 /,
  );
});

test('scenario fixtures that import compiled output are covered by the prebuild', () => {
  const gates = JSON.parse(read('package.json')).scripts['test:release-gates'];
  const prebuild = gates.split('&&')[0];
  // Derive the requirement from the fixtures instead of hardcoding it, so a new
  // scenario that reaches into another package's dist fails here rather than in
  // CI with an opaque module-resolution error.
  const runners = execFileSync(
    'grep',
    ['-rlE', 'apps/api/dist|apps/cli/dist', 'scenarios'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  assert.ok(runners.length > 0, 'expected scenario runners importing compiled output');
  if (runners.some((f) => read(f).includes('apps/api/dist'))) {
    assert.match(prebuild, /waitlayer-api\.\.\./, 'API fixtures require the API in the prebuild');
  }
  if (runners.some((f) => read(f).includes('apps/cli/dist'))) {
    assert.match(prebuild, /waitlayer-cli\.\.\./, 'CLI fixtures require the CLI in the prebuild');
  }
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

test('web runtime image ships every local file next.config.js requires at startup', () => {
  // `next.config.js` is loaded by `next start`, so any `require('./...')` in it
  // must exist in the RUNTIME image — not just the build stage. It did not:
  // the shipped web container started, printed "Ready", then failed every
  // request with "Cannot find module './src/lib/csp.js'". The docker-build gate
  // never caught it because the job died several steps earlier.
  const config = read('apps/web/next.config.js');
  const dockerfile = read('Dockerfile');
  const webStage = dockerfile.slice(dockerfile.indexOf('AS web'));

  const localRequires = [...config.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.ok(localRequires.length > 0, 'expected next.config.js to require local files');

  for (const rel of localRequires) {
    const fromWebRoot = rel.replace(/^\.\//, '');
    assert.ok(
      existsSync(join(root, 'apps/web', fromWebRoot)),
      `next.config.js requires ${rel}, which does not exist in the repo`,
    );
    // Match COPY INSTRUCTIONS only. Scanning the raw stage text would also
    // match the explanatory comment above the COPY, so the guard would pass
    // even after the instruction was deleted.
    const copyLines = webStage
      .split('\n')
      .filter((line) => /^\s*COPY\s/.test(line) && !/^\s*#/.test(line));
    assert.ok(
      copyLines.some((line) => line.includes(fromWebRoot)),
      `next.config.js requires ${rel}, but no COPY in the web runtime stage ships it — ` +
        'the container will start and then fail to load its config',
    );
  }
});

test('prisma CLI is a PRODUCTION dependency, and the image does not reinstall it globally', () => {
  // Load-bearing for the runtime image. `pnpm install --prod` prunes
  // devDependencies, so if prisma moves back to devDependencies the entrypoint
  // loses `packages/db/node_modules/.bin/prisma` and no container can migrate.
  //
  // It also has to stay under pnpm's control: while it was installed with
  // `npm install -g prisma`, the workspace `find-my-way: 9.7.0` security
  // override could not reach it, `@prisma/dev` resolved its exact 9.6.0 pin,
  // and the shipped image carried a HIGH CVE the pnpm tree did not have.
  const db = JSON.parse(read('packages/db/package.json'));
  assert.ok(db.dependencies?.prisma, 'prisma must be a production dependency of packages/db');
  assert.ok(
    !db.devDependencies?.prisma,
    'prisma must not ALSO be a devDependency — the prod entry is what survives --prod',
  );

  const dockerfile = read('Dockerfile');
  assert.doesNotMatch(
    dockerfile,
    /^\s*RUN[^\n]*npm install -g prisma/m,
    'the image must not install the Prisma CLI globally — that bypasses pnpm overrides',
  );
  assert.doesNotMatch(
    dockerfile,
    /^\s*ENV NODE_PATH=/m,
    'NODE_PATH was the workaround for the global install and is no longer needed',
  );

  // npm is build-time only. Shipping it means shipping its bundled dependency
  // tree (tar, sigstore, ip-address, brace-expansion, picomatch), which was 10
  // of the 11 CRITICAL/HIGH findings in the image scan.
  const runtimeStages = dockerfile.split(/^FROM /m).filter((st) => /^base AS (api|web)\b/.test(st));
  assert.equal(runtimeStages.length, 2, 'expected an api and a web runtime stage');
  for (const stage of runtimeStages) {
    assert.match(
      stage,
      /rm -rf \/usr\/local\/lib\/node_modules\/npm/,
      'each runtime stage must remove npm after its installs complete',
    );
  }
});

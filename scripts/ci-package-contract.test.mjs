import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

/**
 * Body of one Dockerfile stage. The image is built in two stages per target:
 * `assemble_<name>` creates every file as root, and `<name>` takes the finished
 * tree in one ownership-correct copy (A-112). So "is this file in the image?"
 * is a question about the assemble stage plus the hand-off, not about a single
 * stage.
 */
function dockerStage(name) {
  const dockerfile = read('Dockerfile');
  const start = dockerfile.search(new RegExp(`^FROM [^\\n]* AS ${name}$`, 'm'));
  assert.notEqual(start, -1, `no Dockerfile stage named ${name}`);
  const rest = dockerfile.slice(start + 1);
  const next = rest.search(/^FROM /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function copyInstructions(stageBody) {
  // COPY INSTRUCTIONS only. Scanning raw stage text would also match the
  // explanatory comments above them, so a guard would pass after the
  // instruction itself was deleted.
  return stageBody.split('\n').filter((line) => /^\s*COPY\s/.test(line));
}

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
  const assemble = copyInstructions(dockerStage('assemble_web'));
  const runtime = dockerStage('web');

  const localRequires = [...config.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.ok(localRequires.length > 0, 'expected next.config.js to require local files');

  for (const rel of localRequires) {
    const fromWebRoot = rel.replace(/^\.\//, '');
    assert.ok(
      existsSync(join(root, 'apps/web', fromWebRoot)),
      `next.config.js requires ${rel}, which does not exist in the repo`,
    );
    assert.ok(
      assemble.some((line) => line.includes(fromWebRoot)),
      `next.config.js requires ${rel}, but no COPY assembles it into the web image — ` +
        'the container will start and then fail to load its config',
    );
  }

  // The assembled tree only reaches the shipped image through this hand-off.
  // Without it every assertion above would be about a stage that is discarded.
  assert.match(
    runtime,
    /^COPY --from=assemble_web --chown=node:node \/app \/app$/m,
    'the web runtime stage must copy the assembled tree, ownership set at copy time',
  );
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

  // npm and pnpm are build-time only. Shipping them means shipping their
  // bundled dependency trees: npm's (tar, sigstore, ip-address,
  // brace-expansion, picomatch) was 10 of the 11 findings in the first image
  // scan, and pnpm's own `tar` 7.5.16 was the remaining CRITICAL + HIGH. That
  // tar appears nowhere in pnpm-lock.yaml, so no override can reach it —
  // removing the tool is the only fix that is not a suppression.
  // Keyed on the stage NAME, not its parent image: the runtime stages were
  // rebased off `base` onto plain node:22-alpine to drop a 1.73 GB dev install
  // they never use, and a guard tied to the parent would have silently stopped
  // matching anything and passed vacuously.
  const runtimeStages = ['api', 'web'].map((name) => dockerStage(name));
  assert.equal(runtimeStages.length, 2, 'expected an api and a web runtime stage');
  for (const stage of runtimeStages) {
    assert.doesNotMatch(
      stage,
      /^FROM /m,
      'dockerStage should return a single stage body',
    );
  }
  for (const stage of runtimeStages) {
    for (const tool of ['npm', 'pnpm']) {
      assert.match(
        stage,
        new RegExp(`rm -rf [^\\n]*/usr/local/lib/node_modules/${tool}(?![-\\w])`),
        `each runtime stage must remove ${tool} after its installs complete`,
      );
    }
  }
});

test('the API image bakes in the Prisma schema engine instead of downloading it at boot', () => {
  // `@prisma/engines` does not ship the ~22 MB `schema-engine-<platform>`
  // binary in its tarball — its postinstall downloads it. The runtime stage
  // installs with `--ignore-scripts`, so without an explicit fetch the binary
  // is absent and Prisma pulls it lazily on first use. In a container that
  // first use is `prisma migrate deploy` in the entrypoint, so EVERY container
  // start downloaded 22 MB before the app could boot: cold start went from ~8s
  // to 46s, one CI run never passed its healthcheck at all (272s of failing
  // probes, then "dependency failed to start"), and an image built this way
  // cannot start on a host with no egress to Prisma's CDN.
  const assemble = dockerStage('assemble_api');

  const installIndex = assemble.search(/^RUN[^\n]*pnpm install --prod/m);
  const ensureIndex = assemble.search(/^RUN[^\n]*ensure-prisma-engines\.mjs/m);
  assert.ok(
    installIndex !== -1,
    'the api image must still do a production-only install',
  );
  assert.ok(
    ensureIndex !== -1,
    'the api image must run scripts/ensure-prisma-engines.mjs so the engine is baked in',
  );
  assert.ok(
    ensureIndex > installIndex,
    'the engine fetch must run AFTER the production install, or it resolves nothing',
  );

  // The engine is only in the shipped image if the assembled tree is handed off.
  assert.match(
    dockerStage('api'),
    /^COPY --from=assemble_api --chown=node:node \/app \/app$/m,
    'the api runtime stage must copy the assembled tree, ownership set at copy time',
  );

  // And the script itself must still fail closed. A version that logs a
  // warning instead of exiting non-zero would let the defect ship silently.
  const script = read('scripts/ensure-prisma-engines.mjs');
  assert.match(
    script,
    /process\.exit\(1\)/,
    'ensure-prisma-engines must fail the build when the engine is missing',
  );
});

test('the engine fetch can still resolve @prisma/engines through the production chain', async () => {
  // The fetch above is useless if it cannot find the package. Resolution walks
  // packages/db -> prisma -> @prisma/engines, and every hop must survive
  // `pnpm install --prod`: if prisma ever moves back to devDependencies the
  // runtime image loses the CLI entirely, and this resolution is the first
  // thing that breaks. Hermetic — no network, no download, just resolution.
  const { resolveEnginesDir, foundEngines, ENGINE_PREFIX } = await import(
    '../scripts/ensure-prisma-engines.mjs'
  );

  const dir = resolveEnginesDir(root);
  assert.ok(
    existsSync(join(dir, 'package.json')),
    `resolved @prisma/engines to ${dir}, which has no package.json`,
  );
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@prisma/engines');

  // The binary is genuinely absent from the published tarball — that premise is
  // the whole reason the fetch exists, so assert it rather than trusting it.
  assert.ok(
    !(pkg.files ?? []).some((f) => f.startsWith(ENGINE_PREFIX)),
    'if @prisma/engines starts shipping the engine, the build-time fetch can go',
  );
  assert.deepEqual(foundEngines(dir).filter((n) => !n.startsWith(ENGINE_PREFIX)), []);
});

test('the gitleaks baseline stays a precise fingerprint list, never a path allowlist', () => {
  // The baseline exists so full-history secret scanning can run at all (the
  // action only scans the triggering event's commits, so history had never been
  // scanned). That is only safe while every entry pins one exact historical
  // finding. A path glob such as `*.spec.ts` would blind the scanner to a real
  // secret pasted into a spec file — precisely the case it exists to catch.
  const raw = read('.gitleaksignore');
  const entries = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  assert.ok(entries.length > 0, 'baseline is empty — did the file move?');
  for (const entry of entries) {
    assert.match(
      entry,
      /^[0-9a-f]{40}:[^:*?]+:[^:*?]+:\d+$/,
      `not an exact commit:path:rule:line fingerprint: ${entry}`,
    );
  }

  // A cap, so growing the baseline is a deliberate act with a diff to review
  // rather than something that quietly absorbs new findings.
  const CAP = 23;
  assert.ok(
    entries.length <= CAP,
    `baseline grew to ${entries.length} (cap ${CAP}). Verify each NEW finding is ` +
      'benign at its flagged commit and raise the cap in the same commit — never ' +
      'append without doing that.',
  );
});

test('runtime images drop to a non-root user and carry no recursive chown layer', () => {
  for (const name of ['api', 'web']) {
    const stage = dockerStage(name);

    // The security property: neither image may run as root.
    assert.match(stage, /^USER node$/m, `${name} must drop to the node user`);
    assert.ok(
      stage.indexOf('USER node') > stage.lastIndexOf('COPY '),
      `${name}: USER node must come after the COPY steps`,
    );

    // The performance property (A-112): a recursive chown re-touches the inode
    // of every file already copied, so overlayfs copies them all up — a
    // measured 1.18 GB layer on a 4.75 GB image, and the slowest build step.
    // Ownership belongs on the single hand-off COPY instead.
    assert.doesNotMatch(
      stage,
      /^RUN chown -R /m,
      `${name} must set ownership via COPY --chown on the assembled tree`,
    );

    // And nothing may CREATE files after that copy — that is exactly what broke
    // the first attempt: the --prod install, engine fetch and `prisma generate`
    // ran after the copies and left root-owned files the app could not use.
    const afterCopy = stage.slice(stage.lastIndexOf('COPY '));
    const creators = afterCopy
      .split('\n')
      .filter((line) => /^RUN /.test(line) && !/^RUN rm -rf /.test(line));
    assert.deepEqual(
      creators,
      [],
      `${name}: no step may create files after the ownership-setting COPY — ` +
        `they would land root-owned and unreachable to the runtime user. Found: ${creators.join(' | ')}`,
    );
  }
});

test('the gitleaks config extends the default rules and excludes only the baseline file', () => {
  // A gitleaks config REPLACES the default ruleset unless it opts back in.
  // Without `useDefault`, adding this file to exclude one path would silently
  // disable every upstream secret rule — turning a scanner into a no-op while
  // still reporting green.
  const config = read('.gitleaks.toml');
  assert.match(
    config,
    /^\s*useDefault\s*=\s*true\s*$/m,
    'gitleaks config must extend the default ruleset, never replace it',
  );

  // The only allowlisted path may be the baseline file. Anything broader (a
  // source directory, a *.spec.ts glob) would blind the scanner to real
  // secrets — the exact failure this whole baseline is built to avoid.
  const paths = [...config.matchAll(/'''([^']*)'''/g)].map(([, p]) => p);
  assert.deepEqual(
    paths,
    ['^\\.gitleaksignore$'],
    'the allowlist must cover exactly .gitleaksignore and nothing else',
  );
  assert.doesNotMatch(config, /^\s*stopwords\s*=/m, 'stopwords would mute rules globally');
  assert.doesNotMatch(config, /^\s*regexes\s*=/m, 'a content regex allowlist would mute real secrets');
});

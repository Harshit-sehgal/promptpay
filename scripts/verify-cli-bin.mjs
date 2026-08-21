import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Verifies that every `bin` entry declared in apps/cli/package.json points to
 * a built artifact that actually exists and is executable by npm as a Node
 * bin. Run after build, e.g. in CI before `npm publish` / `npm pack`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cliPkgPath = resolve(here, '../apps/cli/package.json');
const pkg = JSON.parse(readFileSync(cliPkgPath, 'utf-8'));

const dependencySections = ['dependencies', 'optionalDependencies', 'peerDependencies'];
for (const section of dependencySections) {
  for (const [name, version] of Object.entries(pkg[section] ?? {})) {
    if (name.startsWith('@ateva/') || String(version).startsWith('workspace:')) {
      console.error(
        `[verify-cli-bin] FAIL: published ${section} contains private workspace dependency ${name}@${version}`,
      );
      process.exitCode = 1;
    }
  }
}

const bins = typeof pkg.bin === 'string' ? { cli: pkg.bin } : (pkg.bin ?? {});
let ok = true;
for (const [name, rel] of Object.entries(bins)) {
  const abs = resolve(dirname(cliPkgPath), rel);
  if (!existsSync(abs)) {
    console.error(
      `[verify-cli-bin] FAIL: bin "${name}" -> ${rel} does not exist. Run the CLI build first.`,
    );
    ok = false;
  } else {
    const firstLine = readFileSync(abs, 'utf-8').split(/\r?\n/, 1)[0];
    if (firstLine !== '#!/usr/bin/env node') {
      console.error(`[verify-cli-bin] FAIL: bin "${name}" -> ${rel} is missing the Node shebang.`);
      ok = false;
    } else {
      console.log(`[verify-cli-bin] OK: ${name} -> ${rel}`);
    }
  }
}

if (!ok || process.exitCode) process.exit(1);

// Prove that the packaged entrypoint itself is self-contained. Run a copy from
// the OS temp directory with NODE_PATH cleared, so module resolution cannot
// accidentally fall back to this monorepo's workspace links.
const isolatedRoot = mkdtempSync(resolve(tmpdir(), 'ateva-cli-bin-'));
try {
  const isolatedDist = resolve(isolatedRoot, 'dist');
  mkdirSync(isolatedDist);
  cpSync(resolve(dirname(cliPkgPath), 'dist/index.js'), resolve(isolatedDist, 'index.js'));
  writeFileSync(resolve(isolatedRoot, 'package.json'), JSON.stringify(pkg));

  for (const arg of ['--version', '--help']) {
    const result = spawnSync(process.execPath, [resolve(isolatedDist, 'index.js'), arg], {
      cwd: isolatedRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
    });
    if (result.status !== 0) {
      console.error(
        `[verify-cli-bin] FAIL: isolated ateva ${arg} exited ${result.status}\n${result.stderr}`,
      );
      process.exit(1);
    }
  }
  console.log('[verify-cli-bin] OK: isolated bundle runs without monorepo dependencies');
} finally {
  rmSync(isolatedRoot, { recursive: true, force: true });
}

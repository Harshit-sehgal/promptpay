import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const scanner = join(root, 'scripts', 'scan-build-secrets.mjs');
const privateKeyMarker = '-----BEGIN PRIVATE KEY-----';

function runScanner(target) {
  return spawnSync(process.execPath, [scanner, target], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Avoid depending on any locally-built Docker image while testing the
      // filesystem scan.
      SCAN_IMAGE_NAMES: '__scan-build-secrets-test-image-does-not-exist__',
    },
  });
}

function withNextOutput(callback) {
  const directory = mkdtempSync(join(tmpdir(), 'ateva-scan-build-secrets-'));
  const next = join(directory, '.next');
  mkdirSync(join(next, 'dev', 'server'), { recursive: true });
  mkdirSync(join(next, 'server'), { recursive: true });

  try {
    return callback(next);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('ignores stale Next development output while scanning the build root', () => {
  withNextOutput((next) => {
    writeFileSync(join(next, 'dev', 'server', 'middleware.js'), privateKeyMarker);
    writeFileSync(join(next, 'server', 'middleware.js'), 'production bundle');

    const result = runScanner(next);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No signing secrets detected/);
  });
});

test('still detects a marker in the production Next output', () => {
  withNextOutput((next) => {
    const productionFile = join(next, 'server', 'middleware.js');
    writeFileSync(productionFile, privateKeyMarker);

    const result = runScanner(next);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Potential secrets found/);
    assert.match(result.stderr, /server[\\/]middleware\.js/);
  });
});

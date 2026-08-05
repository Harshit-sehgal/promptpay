import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url).pathname;

test('release evidence generator records immutable source and explicit gate results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'waitlayer-evidence-'));
  const output = join(dir, 'manifest.json');
  execFileSync(
    'node',
    [
      'scripts/release-evidence.mjs',
      '--output',
      output,
      '--environment',
      'sandbox',
      '--environment-id',
      'test-run-1',
      '--protocol',
      '1',
      '--gate',
      'typecheck=passed',
      '--gate',
      'lint=passed',
    ],
    { cwd: root, stdio: 'pipe' },
  );

  const manifest = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.environmentKind, 'sandbox');
  assert.equal(manifest.environmentId, 'test-run-1');
  assert.equal(manifest.protocolVersion, 1);
  assert.equal(manifest.gates.typecheck, 'passed');
  assert.equal(manifest.gates.lint, 'passed');
  assert.match(manifest.git.sha, /^[0-9a-f]{40}$/);
});

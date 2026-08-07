import assert from 'node:assert/strict';
import test from 'node:test';

import { classify, evaluateLicenseInventory } from './check-licenses.mjs';

test('accepts the reviewed EPL family', () => {
  assert.equal(classify('EPL-2.0'), 'accepted');
});

test('accepts exact reviewed non-SPDX package versions', () => {
  const result = evaluateLicenseInventory({
    Unknown: [
      { name: 'pause', versions: ['0.0.1'] },
      { name: '@vscode/vsce-sign', versions: ['2.0.9'] },
      { name: '@vscode/vsce-sign-linux-x64', versions: ['2.0.6'] },
    ],
  });

  assert.equal(result.unresolvedReviews.length, 0);
  assert.equal(result.reviewedOverrides.length, 3);
});

test('fails closed when an unknown package or reviewed package version changes', () => {
  const result = evaluateLicenseInventory({
    Unknown: [
      { name: 'new-unknown-package', versions: ['1.0.0'] },
      { name: 'pause', versions: ['0.0.2'] },
    ],
  });

  assert.deepEqual(
    result.unresolvedReviews.map(({ name, version }) => `${name}@${version}`),
    ['new-unknown-package@1.0.0', 'pause@0.0.2'],
  );
});

test('keeps denied licenses fatal', () => {
  const result = evaluateLicenseInventory({
    'AGPL-3.0': [{ name: 'network-copyleft', versions: ['1.0.0'] }],
  });

  assert.equal(result.offenders.length, 1);
  assert.equal(result.unresolvedReviews.length, 0);
});

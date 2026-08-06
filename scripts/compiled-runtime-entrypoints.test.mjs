import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('compiled runtime packages do not point Node at TypeScript source', () => {
  const packageJson = JSON.parse(fs.readFileSync('packages/config/package.json', 'utf8'));
  assert.equal(packageJson.main, './dist/index.js');
  assert.equal(packageJson.types, './dist/index.d.ts');
  assert.equal(fs.existsSync('packages/config/dist/index.js'), true);
  assert.equal(fs.existsSync('packages/config/dist/environment.js'), true);
  assert.match(fs.readFileSync('packages/config/dist/index.js', 'utf8'), /require\(/);
});

test('root web launcher delegates start through the workspace package', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['start:web'],
    'pnpm --filter waitlayer-web build && pnpm --filter waitlayer-web start',
  );
});

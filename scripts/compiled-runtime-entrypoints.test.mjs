import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function packageJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('compiled runtime packages do not point Node at TypeScript source', () => {
  const pkg = packageJson('packages/config/package.json');
  assert.equal(pkg.main, './dist/index.js');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.ok(fs.existsSync(path.join(root, 'packages/config/dist/index.js')));
  assert.ok(fs.existsSync(path.join(root, 'packages/config/dist/index.d.ts')));
  assert.match(pkg.scripts.build, /tsconfig\.build\.json/);
});

test('root web launcher delegates start through the workspace web package', () => {
  const pkg = packageJson('package.json');
  assert.equal(
    pkg.scripts['start:web'],
    'pnpm --filter ateva-web build && cd apps/web && next start',
  );
});

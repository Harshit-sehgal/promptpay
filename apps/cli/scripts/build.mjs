import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '../..');
const manifest = JSON.parse(await readFile(resolve(cliRoot, 'package.json'), 'utf8'));

const result = await build({
  absWorkingDir: cliRoot,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minify: true,
  metafile: true,
  logLevel: 'info',
  alias: {
    // These packages are intentionally private monorepo implementation
    // details. Bundle their source into the public CLI so npm never has to
    // resolve an unpublished @waitlayer/* runtime package.
    '@waitlayer/agent-protocol': resolve(repoRoot, 'packages/agent-protocol/src/index.ts'),
    '@waitlayer/shared': resolve(repoRoot, 'packages/shared/src/index.ts'),
  },
  define: {
    'process.env.WAITLAYER_CLI_VERSION': JSON.stringify(manifest.version),
  },
});

const allowedExternal = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const externalImports = Object.values(result.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((entry) => entry.external)
  .map((entry) => entry.path);
const unexpected = [...new Set(externalImports.filter((entry) => !allowedExternal.has(entry)))];
if (unexpected.length > 0) {
  throw new Error(`CLI bundle has unresolved runtime imports: ${unexpected.join(', ')}`);
}

const bundledInputs = Object.keys(result.metafile.inputs);
for (const workspacePackage of ['packages/shared/src/', 'packages/agent-protocol/src/']) {
  if (!bundledInputs.some((input) => input.includes(workspacePackage))) {
    throw new Error(`CLI bundle did not include ${workspacePackage}`);
  }
}

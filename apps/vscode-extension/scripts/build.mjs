import { mkdir, rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';

import { build } from 'esbuild';

await rm('out', { recursive: true, force: true });
await mkdir('out', { recursive: true });
const result = await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'out/extension.js',
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: true,
  metafile: true,
  logLevel: 'info',
});

const externalImports = Object.values(result.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((entry) => entry.external)
  .map((entry) => entry.path);
const allowedExternal = new Set([
  'vscode',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const unexpected = [...new Set(externalImports.filter((path) => !allowedExternal.has(path)))];
if (unexpected.length > 0) {
  throw new Error(`VSIX bundle has unresolved runtime imports: ${unexpected.join(', ')}`);
}

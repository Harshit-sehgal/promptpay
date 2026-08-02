import { mkdir, readFile, rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';

import { build } from 'esbuild';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

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
  define: {
    // esbuild never bundles `require('package.json')` (always external), so
    // the manifest version is injected here instead. Device registration then
    // reports the real packaged version; dev/test source imports fall back to
    // the baseline constant in api-client.ts.
    'process.env.WAITLAYER_EXTENSION_VERSION': JSON.stringify(manifest.version),
  },
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

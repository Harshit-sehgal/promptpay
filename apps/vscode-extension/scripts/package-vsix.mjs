import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv.slice(2).find((argument) => argument !== '--');
const outputPath = resolve(outputArgument || join(extensionRoot, 'waitlayer-vscode.vsix'));
const sourceManifestPath = join(extensionRoot, 'package.json');
const sourceOut = join(extensionRoot, 'out');
const sourceLicense = join(extensionRoot, 'LICENSE');
const sourceIgnore = join(extensionRoot, '.vscodeignore');

if (!existsSync(sourceOut)) {
  throw new Error(`Missing compiled extension output at ${sourceOut}; run pnpm run bundle first`);
}
if (!existsSync(sourceLicense)) {
  throw new Error(`Missing extension license file at ${sourceLicense}`);
}
if (!existsSync(sourceIgnore)) {
  throw new Error(`Missing VSIX inclusion rules at ${sourceIgnore}`);
}

const stagingRoot = await mkdtemp(join(tmpdir(), 'waitlayer-vsix-'));
try {
  const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  // The bundle is self-contained. Development/workspace dependencies are
  // needed to build it, but must never be copied into a published VSIX
  // manifest where workspace:* is neither installable nor meaningful.
  delete manifest.dependencies;
  delete manifest.devDependencies;
  delete manifest.optionalDependencies;
  delete manifest.peerDependencies;
  // vsce runs vscode:prepublish from the package root before packaging. The
  // staged tree intentionally contains only compiled output, so retain no
  // lifecycle scripts that could try to rebuild from the temporary directory.
  delete manifest.scripts;

  await mkdir(join(stagingRoot, 'out'), { recursive: true });
  await writeFile(join(stagingRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(sourceOut, join(stagingRoot, 'out'), { recursive: true });
  await cp(sourceLicense, join(stagingRoot, 'LICENSE'));
  await cp(sourceIgnore, join(stagingRoot, '.vscodeignore'));

  const vsceBin = join(extensionRoot, 'node_modules', '.bin', 'vsce');
  if (!existsSync(vsceBin)) {
    throw new Error(
      `Cannot find vsce executable at ${vsceBin}; install workspace dependencies first`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });

  await new Promise((resolvePromise, reject) => {
    const child = spawn(vsceBin, ['package', '--no-dependencies', '--out', outputPath], {
      cwd: stagingRoot,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`vsce exited with ${code ?? `signal ${signal}`}`));
    });
  });
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

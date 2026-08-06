const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const extensionRoot = path.resolve(process.argv[2] || '');
const packagePath = path.join(extensionRoot, 'package.json');
const entryPath = path.join(extensionRoot, 'out', 'extension.js');

if (!fs.existsSync(packagePath) || !fs.existsSync(entryPath)) {
  throw new Error(`Extracted VSIX is missing package.json or out/extension.js at ${extensionRoot}`);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.main !== './out/extension.js') {
  throw new Error(`Packaged VSIX has unexpected main entry: ${String(pkg.main)}`);
}
const licenseFiles = ['LICENSE', 'LICENSE.txt'];
if (
  pkg.license !== 'SEE LICENSE IN LICENSE' ||
  !licenseFiles.some((name) => fs.existsSync(path.join(extensionRoot, name)))
) {
  throw new Error('Packaged VSIX is missing the declared proprietary LICENSE file');
}
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const workspaceRefs = dependencySections.flatMap((section) =>
  Object.entries(pkg[section] || {})
    .filter(([, version]) => String(version).startsWith('workspace:'))
    .map(([name]) => `${section}.${name}`),
);
if (workspaceRefs.length > 0) {
  throw new Error(
    `Packaged VSIX retains workspace dependency references: ${workspaceRefs.join(', ')}`,
  );
}
for (const section of dependencySections) {
  if (pkg[section] && Object.keys(pkg[section]).length > 0) {
    throw new Error(`Packaged VSIX must be self-contained; found ${section}`);
  }
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const entry = require(entryPath);
  if (typeof entry.activate !== 'function' || typeof entry.deactivate !== 'function') {
    throw new Error('Packaged VSIX entry does not export activate/deactivate');
  }
  process.stdout.write('Packaged VSIX activation smoke passed\n');
} finally {
  Module._load = originalLoad;
}

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
const runtimeDependencies = pkg.dependencies || {};
const workspaceRuntimeRefs = Object.entries(runtimeDependencies).filter(([, version]) =>
  String(version).startsWith('workspace:'),
);
if (workspaceRuntimeRefs.length > 0) {
  throw new Error(
    `Packaged VSIX retains workspace runtime dependencies: ${workspaceRuntimeRefs
      .map(([name]) => name)
      .join(', ')}`,
  );
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

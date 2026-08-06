const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const extensionRoot = path.resolve(process.argv[2] || '');
const entryPath = path.join(extensionRoot, 'out', 'extension.js');
if (!fs.existsSync(entryPath)) throw new Error(`Missing packaged entry at ${entryPath}`);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, parent, isMain, options) {
  if (request.startsWith('@waitlayer/') || request.startsWith('workspace:')) {
    throw new Error(`Packaged extension attempted to resolve workspace module: ${request}`);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};
try {
  const entry = require(entryPath);
  if (typeof entry.activate !== 'function' || typeof entry.deactivate !== 'function') {
    throw new Error('Packaged entry does not export activate/deactivate');
  }
  process.stdout.write('Isolated VSIX runtime smoke passed\n');
} finally {
  Module._load = originalLoad;
  Module._resolveFilename = originalResolve;
}

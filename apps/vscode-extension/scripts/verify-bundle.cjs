const Module = require('node:module');
const path = require('node:path');

const extensionRoot = path.resolve(__dirname, '..');
const entryPath = path.join(extensionRoot, 'out', 'extension.js');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const entry = require(entryPath);
  if (typeof entry.activate !== 'function' || typeof entry.deactivate !== 'function') {
    throw new Error('bundle does not export activate/deactivate');
  }
  process.stdout.write('VS Code bundle smoke passed\n');
} finally {
  Module._load = originalLoad;
}

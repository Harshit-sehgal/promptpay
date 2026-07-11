import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// Generalized god-service decomposer (behaviour-preserving mixin split).
// Usage: node decompose-service.mjs <serviceFile> <ServiceName> <planJson>
// planJson: { groupKey: { "file": "x-foo.trait.ts", "names": ["methodA", ...] }, ... }

const [serviceFile, serviceName, planFile] = process.argv.slice(2);
if (!serviceFile || !serviceName || !planFile) {
  console.error('usage: node decompose-service.mjs <serviceFile> <ServiceName> <planJson>');
  process.exit(1);
}

const planRaw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const dir = path.dirname(serviceFile);
const baseName = path.basename(serviceFile).replace(/\.service\.ts$/, '').replace(/\.ts$/, '');
const constsFile = `${baseName}.constants.ts`;
const constsImportPath = `./${constsFile.replace(/\.ts$/, '')}`;

const src = fs.readFileSync(serviceFile, 'utf8');
const sf = ts.createSourceFile(serviceFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, sf);

const TS_GLOBALS = new Set([
  'Array', 'Promise', 'Object', 'Math', 'JSON', 'String', 'Number', 'Boolean', 'Symbol',
  'BigInt', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'ArrayBuffer',
  'DataView', 'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'Uint8ClampedArray', 'Buffer', 'console', 'process',
  'globalThis', 'Reflect', 'Proxy', 'Function', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'structuredClone',
  'TextDecoder', 'TextEncoder', 'WebAssembly', 'Infinity', 'NaN', 'undefined', 'null', 'void',
]);

const imports = [];
let cls = null;
const topDecls = [];
function visit(n, parent) {
  if (ts.isImportDeclaration(n)) imports.push(n);
  if (ts.isClassDeclaration(n) && n.name && n.name.text === serviceName) cls = n;
  if (parent === sf) {
    if (
      ts.isVariableStatement(n) ||
      ts.isEnumDeclaration(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isInterfaceDeclaration(n) ||
      (ts.isClassDeclaration(n) && n.name && n.name.text !== serviceName)
    ) {
      topDecls.push(n);
    }
  }
  ts.forEachChild(n, (c) => visit(c, n));
}
visit(sf, null);
if (!cls) { console.error('class not found:', serviceName); process.exit(1); }

function methodName(m) { return m.name.getText(sf); }
function usedIdents(node, acc = new Set()) {
  (function walk(n) {
    if (ts.isIdentifier(n)) acc.add(n.text);
    ts.forEachChild(n, walk);
  })(node);
  return acc;
}
function addBindingNames(nameNode, b) {
  if (!nameNode) return;
  if (ts.isIdentifier(nameNode)) b.add(nameNode.text);
  else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    nameNode.elements.forEach((el) => addBindingNames(el.name, b));
  } else if (ts.isBindingElement(nameNode)) addBindingNames(nameNode.name, b);
}
// Free-reference identifiers (runtime values), excluding member names, type nodes,
// and locally-bound names (so local variables are never mistaken for globals).
function refIdents(node, acc = new Set(), bound = new Set()) {
  if (!node || typeof node !== 'object') return acc;
  if (ts.isTypeNode(node)) return acc;
  if (ts.isIdentifier(node)) {
    if (!bound.has(node.text) && node.text !== 'this') acc.add(node.text);
    return acc;
  }
  if (ts.isPropertyAccessExpression(node)) { refIdents(node.expression, acc, bound); return acc; }
  if (ts.isElementAccessExpression(node)) {
    refIdents(node.expression, acc, bound);
    if (node.argumentExpression) refIdents(node.argumentExpression, acc, bound);
    return acc;
  }
  if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
    const b = new Set(bound); addBindingNames(node.name, b);
    if (node.initializer) refIdents(node.initializer, acc, b);
    return acc;
  }
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const b = new Set(bound); node.parameters.forEach((p) => addBindingNames(p.name, b));
    if (node.body) refIdents(node.body, acc, b);
    return acc;
  }
  if (ts.isCatchClause(node)) {
    const b = new Set(bound);
    if (node.variableDeclaration) addBindingNames(node.variableDeclaration.name, b);
    if (node.block) refIdents(node.block, acc, b);
    return acc;
  }
  if (ts.isPropertyAssignment(node)) { refIdents(node.initializer, acc, bound); return acc; }
  if (ts.isShorthandPropertyAssignment(node)) { if (!bound.has(node.name.text)) acc.add(node.name.text); return acc; }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isPropertySignature(node)) {
    const b = new Set(bound);
    if (node.parameters) node.parameters.forEach((p) => addBindingNames(p.name, b));
    if (node.body) refIdents(node.body, acc, b);
    return acc;
  }
  ts.forEachChild(node, (c) => { refIdents(c, acc, bound); });
  return acc;
}
function collectBound(node, b = new Set()) {
  if (!node || typeof node !== 'object') return b;
  if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) {
    addBindingNames(node.name, b);
    if (node.initializer) collectBound(node.initializer, b);
  } else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    node.parameters.forEach((p) => collectBound(p, b));
    if (node.body) collectBound(node.body, b);
  } else if (ts.isCatchClause(node)) {
    if (node.variableDeclaration) collectBound(node.variableDeclaration, b);
    if (node.block) collectBound(node.block, b);
  } else if (ts.isClassDeclaration(node) && node.name) {
    b.add(node.name.text);
  } else if (ts.isVariableStatement(node)) {
    node.declarationList.declarations.forEach((d) => collectBound(d, b));
  }
  ts.forEachChild(node, (c) => { collectBound(c, b); });
  return b;
}
// Names referenced via `this.<name>` — used to detect deps, fields, and cross-trait calls.
function thisRefs(node, acc = new Set()) {
  (function walk(n) {
    if (ts.isPropertyAccessExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(n.name)) acc.add(n.name.text);
      walk(n.expression);
    }
    ts.forEachChild(n, walk);
  })(node);
  return acc;
}

// ---- constructor params (injected deps) ----
const members = cls.members;
const ctor = members.find((m) => ts.isConstructorDeclaration(m));
const ctorParams = [];
const ctorParamNames = new Set();
if (ctor) {
  for (const p of ctor.parameters) {
    const name = p.name.getText(sf);
    ctorParamNames.add(name);
    ctorParams.push({ name, typeText: p.type ? print(p.type) : 'any', typeNode: p.type || null });
  }
}

// ---- class fields ----
const fields = members.filter((m) => ts.isPropertyDeclaration(m));
const fieldNames = new Set(fields.map((f) => f.name.getText(sf)));
function fieldType(f) {
  if (f.type) return f.type.getText(sf);
  if (f.initializer && ts.isNewExpression(f.initializer)) {
    const expr = f.initializer.expression.getText(sf);
    const targs = f.initializer.typeArguments;
    return targs && targs.length ? `${expr}<${targs.map((a) => a.getText(sf)).join(', ')}>` : expr;
  }
  return 'any';
}

// ---- module-level declarations ----
const topDeclNames = new Set();
for (const d of topDecls) {
  if (ts.isVariableStatement(d)) {
    for (const decl of d.declarationList.declarations) topDeclNames.add(decl.name.getText(sf));
  } else if (d.name) topDeclNames.add(d.name.getText(sf));
}
const externalConsts = {};
for (const name of topDeclNames) externalConsts[name] = constsImportPath;

const methods = members.filter((m) => ts.isMethodDeclaration(m));
const methodNames = new Set(methods.map(methodName));
const importedNames = new Set();
for (const imp of imports) {
  const cl = imp.importClause;
  if (!cl) continue;
  if (cl.namedBindings && ts.isNamedImports(cl.namedBindings)) {
    for (const el of cl.namedBindings.elements) importedNames.add(el.name.getText(sf));
  } else if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) {
    importedNames.add(cl.namedBindings.name.getText(sf));
  } else if (cl.name) importedNames.add(cl.name.getText(sf));
}
const localDeclNames = new Set([...topDeclNames, ...ctorParamNames, ...fieldNames, ...methodNames, serviceName]);

function neededImports(used) {
  const byModule = new Map();
  const lines = [];
  const addName = (mod, name) => {
    if (!byModule.has(mod)) byModule.set(mod, []);
    if (!byModule.get(mod).includes(name)) byModule.get(mod).push(name);
  };
  for (const imp of imports) {
    const cl = imp.importClause;
    if (!cl) continue;
    const mod = imp.moduleSpecifier.getText(sf);
    if (cl.namedBindings && ts.isNamedImports(cl.namedBindings)) {
      for (const el of cl.namedBindings.elements) {
        if (used.has(el.name.getText(sf))) addName(mod, el.getText(sf));
      }
    } else if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) {
      const ns = cl.namedBindings.name.getText(sf);
      if (used.has(ns)) lines.push(`import * as ${ns} from ${mod};`);
    } else if (cl.name && used.has(cl.name.getText(sf))) {
      byModule.set(mod, [cl.name.getText(sf)]);
    }
  }
  for (const [name, m] of Object.entries(externalConsts)) {
    if (used.has(name)) addName(`'${m}'`, name);
  }
  for (const [mod, names] of byModule) lines.push(`import { ${names.join(', ')} } from ${mod};`);
  return lines;
}
// UMD/global identifiers referenced but neither imported, locally declared, nor TS builtins.
function umdGlobalImports(used) {
  const lines = [];
  for (const id of used) {
    if (importedNames.has(id) || localDeclNames.has(id) || TS_GLOBALS.has(id)) continue;
    lines.push(`import ${id} from '${id}';`);
  }
  return lines;
}
function stripVisibility(m) {
  const mods = (ts.getModifiers(m) || []).filter(
    (mod) => mod.kind !== ts.SyntaxKind.PrivateKeyword && mod.kind !== ts.SyntaxKind.ProtectedKeyword,
  );
  return ts.factory.updateMethodDeclaration(
    m, mods, m.asteriskToken, m.name, m.questionToken, m.typeParameters,
    m.parameters, m.type, m.body,
  );
}
function withExport(d) {
  if (d.modifiers && d.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return d;
  const mods = [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword), ...(d.modifiers || [])];
  if (ts.isVariableStatement(d)) return ts.factory.updateVariableStatement(d, mods, d.declarationList);
  if (ts.isInterfaceDeclaration(d)) return ts.factory.updateInterfaceDeclaration(d, mods, d.name, d.typeParameters, d.heritageClauses, d.members);
  if (ts.isTypeAliasDeclaration(d)) return ts.factory.updateTypeAliasDeclaration(d, mods, d.name, d.typeParameters, d.type);
  if (ts.isEnumDeclaration(d)) return ts.factory.updateEnumDeclaration(d, mods, d.name, d.members);
  if (ts.isClassDeclaration(d)) return ts.factory.updateClassDeclaration(d, mods, d.name, d.typeParameters, d.heritageClauses, d.members);
  if (ts.isFunctionDeclaration(d)) return ts.factory.updateFunctionDeclaration(d, mods, d.asteriskToken, d.name, d.typeParameters, d.parameters, d.type, d.body);
  return d;
}
function traitNameFor(file) {
  const base = path.basename(file).replace(/\.trait\.ts$/, '');
  const pascal = base.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  return pascal + 'Trait';
}
function traitFileFor(traitName) {
  const b = traitName.replace(/Trait$/, '');
  const kebab = b.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `./${kebab}.trait`;
}

// ---- auto-detect cross-trait `this.<method>` dependencies ----
const ownerOf = new Map();
for (const [key, p] of Object.entries(planRaw)) {
  const t = traitNameFor(p.file);
  for (const name of p.names) ownerOf.set(name, t);
}
const depsOf = new Map();
for (const [key, p] of Object.entries(planRaw)) {
  const t = traitNameFor(p.file);
  const local = new Set();
  for (const name of p.names) {
    const m = members.find((mm) => ts.isMethodDeclaration(mm) && methodName(mm) === name);
    if (!m) continue;
    thisRefs(m).forEach((id) => {
      if (ownerOf.has(id) && ownerOf.get(id) !== t) local.add(ownerOf.get(id));
    });
  }
  depsOf.set(t, local);
}
const closure = (trait) => {
  const seen = new Set();
  const stack = [...(depsOf.get(trait) || [])];
  while (stack.length) {
    const t = stack.pop();
    if (seen.has(t) || t === trait) continue;
    seen.add(t);
    for (const d of depsOf.get(t) || []) if (!seen.has(d) && d !== trait) stack.push(d);
  }
  return [...seen];
};

function traitDeclsAndUsed(thisSet, refSet) {
  const decls = [];
  const depUsed = new Set();
  for (const p of ctorParams) {
    if (thisSet.has(p.name) || p.name === 'prisma') {
      decls.push(`  declare ${p.name}: ${p.typeText};`);
      if (p.typeNode) usedIdents(p.typeNode).forEach((i) => depUsed.add(i));
    }
  }
  for (const f of fields) {
    const fname = f.name.getText(sf);
    if (thisSet.has(fname)) {
      const ft = fieldType(f);
      decls.push(`  declare ${fname}: ${ft};`);
      if (f.type) usedIdents(f.type).forEach((i) => depUsed.add(i));
      else if (f.initializer && ts.isNewExpression(f.initializer)) {
        usedIdents(f.initializer).forEach((i) => depUsed.add(i));
        if (f.initializer.typeArguments) f.initializer.typeArguments.forEach((a) => usedIdents(a).forEach((i) => depUsed.add(i)));
      }
    }
  }
  if (!decls.length) decls.push(`  declare prisma: PrismaService;`);
  return { decls, depUsed };
}

function buildTrait(traitName, file, names) {
  const ms = members.filter((m) => ts.isMethodDeclaration(m) && names.includes(methodName(m)));
  if (ms.length === 0) return null;
  const thisSet = new Set();
  const refSet = new Set();
  const allIdents = new Set();
  const methodBound = new Set();
  ms.forEach((m) => collectBound(m, methodBound));
  ms.forEach((m) => { thisRefs(m, thisSet); refIdents(m, refSet, methodBound); usedIdents(m, allIdents); });
  const { decls, depUsed } = traitDeclsAndUsed(thisSet, refSet);
  const used = new Set([...allIdents, ...depUsed, 'PrismaService']);
  const extraTypeImports = [];
  if (used.has(serviceName)) extraTypeImports.push(`import { ${serviceName} } from './${baseName}.service';`);
  const importLines = neededImports(used);
  const globalLines = umdGlobalImports(refSet);
  const body = ms.map((m) => '\n' + print(stripVisibility(m))).join('\n');
  const deps = closure(traitName);
  const depImports = deps.map((d) => `import { ${d} } from '${traitFileFor(d)}';`);
  const content =
    (extraTypeImports.length ? extraTypeImports.join('\n') + '\n' : '') +
    (importLines.length ? importLines.join('\n') + '\n' : '') +
    (globalLines.length ? globalLines.join('\n') + '\n' : '') +
    (depImports.length ? depImports.join('\n') + '\n' : '') +
    `\nexport class ${traitName} {\n${decls.join('\n')}\n${body}\n}\n` +
    (deps.length ? `export interface ${traitName} extends ${deps.join(', ')} {}\n` : '');
  fs.writeFileSync(`${dir}/${file}`, content);
  console.log(`wrote ${file} (${ms.length} methods)`);
  return { trait: traitName, file };
}

const groupedNames = new Set(Object.values(planRaw).flatMap((p) => p.names));
const misc = methods.filter((m) => !groupedNames.has(methodName(m)));

const written = [];
for (const [key, p] of Object.entries(planRaw)) {
  const r = buildTrait(traitNameFor(p.file), p.file, p.names);
  if (r) written.push(r);
}
if (misc.length) {
  const thisSet = new Set();
  const refSet = new Set();
  const allIdents = new Set();
  const methodBound = new Set();
  misc.forEach((m) => collectBound(m, methodBound));
  misc.forEach((m) => { thisRefs(m, thisSet); refIdents(m, refSet, methodBound); usedIdents(m, allIdents); });
  const { decls, depUsed } = traitDeclsAndUsed(thisSet, refSet);
  const used = new Set([...allIdents, ...depUsed, 'PrismaService']);
  const importLines = neededImports(used);
  const globalLines = umdGlobalImports(refSet);
  const body = misc.map((m) => '\n' + print(stripVisibility(m))).join('\n');
  const content =
    (importLines.length ? importLines.join('\n') + '\n' : '') +
    (globalLines.length ? globalLines.join('\n') + '\n' : '') +
    `\nexport class ${serviceName}MiscTrait {\n${decls.join('\n')}\n${body}\n}\n`;
  fs.writeFileSync(`${dir}/${serviceName.toLowerCase()}-misc.trait.ts`, content);
  written.push({ trait: `${serviceName}MiscTrait`, file: `${serviceName.toLowerCase()}-misc.trait.ts` });
  console.log(`wrote ${serviceName.toLowerCase()}-misc.trait.ts (${misc.length} methods: ${misc.map(methodName).join(', ')})`);
}

// ---- relocate module-level declarations to <service>.constants.ts ----
if (topDecls.length) {
  let constUsed = new Set();
  topDecls.forEach((d) => usedIdents(d).forEach((i) => constUsed.add(i)));
  for (const n of topDeclNames) constUsed.delete(n); // declared locally in this file
  const constImports = neededImports(constUsed);
  const constBody = topDecls.map((d) => print(withExport(d))).join('\n\n');
  fs.writeFileSync(`${dir}/${constsFile}`, (constImports.length ? constImports.join('\n') + '\n\n' : '') + constBody + '\n');
  console.log(`wrote ${constsFile} (${topDecls.length} top-level declarations)`);
}

// ---- rewrite facade class ----
function decoratorsOf(node) {
  const out = [];
  if (node.decorators) out.push(...node.decorators);
  if (node.modifiers) for (const m of node.modifiers) if (ts.isDecorator(m)) out.push(m);
  return out;
}
const classDecoratorsList = decoratorsOf(cls);
const classDecorators = classDecoratorsList.length
  ? classDecoratorsList.map((d) => print(d)).join('\n') + '\n'
  : '';
const traitImports = written
  .map((w) => `import { ${w.trait} } from './${w.file.replace(/\.ts$/, '')}';`)
  .join('\n');
const traitList = written.map((w) => w.trait).join(', ');
const assignLoop = written
  .map(
    (w) => `for (const name of Object.getOwnPropertyNames(${w.trait}.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    ${serviceName}.prototype,
    name,
    Object.getOwnPropertyDescriptor(${w.trait}.prototype, name) as PropertyDescriptor,
  );
}`,
  )
  .join('\n');

let newCtor = '';
if (ctor) {
  const params = ctor.parameters
    .map((p) => {
      const name = p.name.getText(sf);
      const typeText = p.type ? print(p.type) : 'any';
      const rest = p.dotDotDotToken ? '...' : '';
      const opt = p.questionToken ? '?' : '';
      return `${rest}public ${name}${opt}: ${typeText}`;
    })
    .join(', ');
  const ctorBody = ctor.body ? print(ctor.body) : '{}';
  newCtor = `  constructor(${params}) ${ctorBody}`;
}

const fieldTexts = fields.map((f) => {
  const name = f.name.getText(sf);
  const ft = fieldType(f);
  const init = f.initializer ? ` = ${print(f.initializer)}` : '';
  const mods = (ts.getModifiers(f) || []).map((m) => m.getText(sf));
  // keep `static` (and readonly) for static fields; drop instance visibility to match trait `declare`
  const isStatic = (ts.getModifiers(f) || []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
  const prefix = isStatic ? mods.filter((m) => m !== 'private' && m !== 'protected').join(' ') + ' ' : '';
  return `  ${prefix}${name}: ${ft}${init};`;
});

const mainBody = [newCtor, ...fieldTexts].filter(Boolean).join('\n');

const mainUsed = new Set();
if (ctor) usedIdents(ctor, mainUsed);
if (classDecoratorsList.length) classDecoratorsList.forEach((d) => usedIdents(d, mainUsed));
fields.forEach((f) => {
  usedIdents(f, mainUsed);
  if (f.initializer) usedIdents(f.initializer, mainUsed);
});
const mainRefs = new Set();
if (ctor) { const cb = collectBound(ctor, new Set()); refIdents(ctor, mainRefs, cb); }
if (classDecoratorsList.length) classDecoratorsList.forEach((d) => refIdents(d, mainRefs));
fields.forEach((f) => {
  const fb = collectBound(f, new Set());
  refIdents(f, mainRefs, fb);
  if (f.initializer) refIdents(f.initializer, mainRefs, fb);
});
const mainImports = neededImports(mainUsed);
const mainGlobalImports = umdGlobalImports(mainRefs);

const constsReexport = topDecls.length ? `\nexport * from '${constsImportPath}';\n` : '';
const newMain =
`${mainImports.join('\n')}
${mainGlobalImports.join('\n')}
${traitImports}

${classDecorators}export class ${serviceName} {
${mainBody}
}

export interface ${serviceName} extends ${traitList} {}

${assignLoop}${constsReexport}`;

fs.writeFileSync(serviceFile, newMain);
console.log(`rewrote ${serviceFile} (${methods.length} methods extracted, ${written.length} traits)`);

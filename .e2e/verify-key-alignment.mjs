#!/usr/bin/env node
/**
 * E2E JWT keypair alignment check.
 *
 * The API signs JWTs with its own .env keypair; the web middleware verifies
 * with the JWT_PUBLIC_KEY it reads at request time; the Playwright harness
 * exports a third keypair from .e2e/*.pem. All three MUST be one keypair or
 * every protected-route browser test fails closed (26-test auth collapse,
 * AGENTS.md 2026-08-02).
 *
 * This script parses the env files itself (PEM values are single-line quoted
 * with literal \n escapes in root .env; multi-line blocks in apps/api/.env;
 * bash `source` mangles both) and compares SPKI fingerprints.
 *
 * Exit 0 when all present sources agree (or no key material exists yet).
 * Exit 1 with actionable guidance on any mismatch or unparsable PEM.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const ROOT_ENV = resolve(ROOT, '.env');
const API_ENV = resolve(ROOT, 'apps/api/.env');
const E2E_PUB = resolve(ROOT, '.e2e/jwt-public.pem');
const E2E_PRIV = resolve(ROOT, '.e2e/jwt-private.pem');

/** Minimal dotenv parser: unquoted, single/double quoted, \n escapes,
 * multi-line double-quoted values. Comments and blank lines skipped. */
function parseEnvFile(path) {
  const text = readFileSync(path, 'utf8');
  const out = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*(?:#|$)/.test(line)) { i += 1; continue; }
    const eq = line.indexOf('=');
    if (eq < 0) { i += 1; continue; }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"')) {
      value = value.slice(1);
      while (!value.endsWith('"') && i + 1 < lines.length) {
        i += 1;
        value += `\n${lines[i]}`;
      }
      if (value.endsWith('"')) value = value.slice(0, -1);
      value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (value.startsWith("'")) {
      value = value.endsWith("'") ? value.slice(1, -1) : value.slice(1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash);
    }
    out[key] = value.trim();
    i += 1;
  }
  return out;
}

/** SPKI SHA-256 fingerprint of a PEM key (public or private). */
function fingerprint(pem) {
  const spki = createPublicKey(pem).export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(spki).digest('hex');
}

const sources = [];

for (const [label, path] of [
  ['root .env', ROOT_ENV],
  ['apps/api/.env', API_ENV],
]) {
  if (!existsSync(path)) continue;
  try {
    const env = parseEnvFile(path);
    if (env.JWT_PUBLIC_KEY) sources.push([`${label} JWT_PUBLIC_KEY`, env.JWT_PUBLIC_KEY]);
    if (env.JWT_PRIVATE_KEY) sources.push([`${label} JWT_PRIVATE_KEY`, env.JWT_PRIVATE_KEY]);
  } catch (error) {
    console.error(`Cannot parse ${path}: ${error.message}`);
    process.exit(1);
  }
}

for (const [label, path] of [
  ['E2E public key', E2E_PUB],
  ['E2E private key', E2E_PRIV],
]) {
  if (existsSync(path)) {
    try {
      sources.push([label, readFileSync(path, 'utf8')]);
    } catch (error) {
      console.error(`Cannot read ${path}: ${error.message}`);
      process.exit(1);
    }
  }
}

if (sources.length === 0) {
  console.log('No JWT key material found; alignment check skipped.');
  process.exit(0);
}

const fingerprints = [];
for (const [label, pem] of sources) {
  try {
    fingerprints.push([label, fingerprint(pem)]);
  } catch (error) {
    console.error(`${label} is not a valid PEM key: ${error.message}`);
    console.error('  Check for mangled multi-line PEM values (bash `source` drops them).');
    process.exit(1);
  }
}

const expected = fingerprints[0][1];
const mismatched = fingerprints.filter(([, fp]) => fp !== expected);
if (mismatched.length > 0) {
  console.error('JWT keypair MISALIGNMENT — protected-route e2e tests will fail closed:');
  for (const [label, fp] of fingerprints) {
    console.error(`  ${label.padEnd(34)} ${fp.slice(0, 16)}${fp === expected ? '' : '  <-- MISMATCH'}`);
  }
  console.error(
    '\nFix: use ONE keypair everywhere. In root .env keep PEMs as single-line quoted values',
    'with literal \\n escapes (docker compose cannot parse multi-line values); multi-line',
    'PEM blocks belong in apps/api/.env only; .e2e/*.pem must match both.',
  );
  process.exit(1);
}

console.log(`JWT keypair alignment OK (${fingerprints.length} sources agree: ${expected.slice(0, 16)}…)`);
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A-018: Google Identity Services (GIS) renders its account-picker popup and
// One-Tap prompt inside a cross-origin iframe at accounts.google.com, and it
// loads its bootstrap script from accounts.google.com/gsi/client. Both must be
// present in the production CSP or Google sign-in cannot complete under CSP.
//
// This test statically asserts those CSP directives exist in next.config.js,
// which is feasible without a browser. It does not require a running server.

function readCsp(): string {
  const configPath = resolve(__dirname, '../next.config.js');
  const source = readFileSync(configPath, 'utf8');
  const match = source.match(/Content-Security-Policy[\s\S]*?value:\s*"(.*?)"/);
  if (!match) {
    throw new Error('Could not find Content-Security-Policy value in next.config.js');
  }
  return match[1];
}

function directives(csp: string): Record<string, string> {
  return csp.split(';').reduce<Record<string, string>>((acc, directive) => {
    const trimmed = directive.trim();
    if (!trimmed) return acc;
    const idx = trimmed.indexOf(' ');
    const name = idx === -1 ? trimmed : trimmed.slice(0, idx);
    const value = idx === -1 ? '' : trimmed.slice(idx + 1).trim();
    acc[name] = value;
    return acc;
  }, {});
}

describe('Google sign-in CSP (A-018)', () => {
  const csp = readCsp();
  const dirs = directives(csp);

  it('defines a frame-src directive allowing the Google accounts origin', () => {
    expect(dirs['frame-src']).toBeDefined();
    expect(dirs['frame-src']).toContain('https://accounts.google.com');
  });

  it('defines a script-src directive allowing the Google gsi/client bootstrap', () => {
    expect(dirs['script-src']).toBeDefined();
    expect(dirs['script-src']).toContain('https://accounts.google.com/gsi/client');
  });
});

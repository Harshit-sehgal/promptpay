#!/usr/bin/env node
/**
 * Scan built artifacts and Docker image layers for production signing secrets.
 *
 * P0.8: production signing secrets (JWT_SECRET, JWT_PRIVATE_KEY, database
 * passwords, provider API keys, etc.) must never be embedded in build outputs.
 * This script is run in CI after `pnpm build` and after `docker build` to catch
 * accidental leakage.
 *
 * Usage:
 *   node scripts/scan-build-secrets.mjs [path-to-scan]
 *
 * Defaults to scanning `apps/web/.next` and `apps/api/dist`.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Patterns that indicate a secret value. We intentionally avoid matching the
// variable names alone (which appear in source code) and focus on high-signal
// patterns: PEM headers, long random tokens, and known placeholder strings.
const SECRET_PATTERNS = [
  // Private key / certificate PEM blocks
  /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/,
  /-----BEGIN CERTIFICATE-----/,
  // Explicit secret assignments in built JS (minified or not)
  /JWT_SECRET[=:]\s*["'][^"']{32,}["']/,
  /JWT_PRIVATE_KEY[=:]\s*["'][^"']{100,}["']/,
  /DATABASE_URL[=:]\s*["'][^"']{30,}["']/,
  // Stripe live/test secret keys
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b/,
];

const PLACEHOLDER_SECRETS = [
  'dev-only-docker-compose-jwt-secret-at-least-32-char',
  'test-jwt-secret-for-integration-test-runs-only-32+',
];

// Files/extensions that are not useful to scan and commonly contain false positives.
const EXCLUDED_EXTENSIONS = new Set(['.map']);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function isText(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(`.${ext}`)) return false;
  return ['js', 'mjs', 'cjs', 'ts', 'json', 'html', 'css', 'txt'].includes(ext);
}

function scanFile(path) {
  const findings = [];
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return findings;
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({ path, pattern: pattern.toString() });
    }
  }

  for (const placeholder of PLACEHOLDER_SECRETS) {
    if (content.includes(placeholder)) {
      findings.push({ path, pattern: `placeholder: ${placeholder}` });
    }
  }

  return findings;
}

function scanDirectory(dir) {
  const findings = [];
  for (const path of walk(dir)) {
    if (!isText(path)) continue;
    findings.push(...scanFile(path));
  }
  return findings;
}

function scanDockerImageHistory(imageName) {
  const findings = [];
  try {
    const history = execSync(`docker history --no-trunc ${imageName}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(history)) {
        findings.push({ image: imageName, pattern: pattern.toString() });
      }
    }
  } catch {
    // Image not built or docker unavailable — skip
  }
  return findings;
}

function main() {
  const explicit = process.argv.slice(2);
  const targets = explicit.length > 0 ? explicit : [
    join(ROOT, 'apps', 'web', '.next'),
    join(ROOT, 'apps', 'api', 'dist'),
  ];

  const allFindings = [];

  for (const target of targets) {
    if (!existsSync(target)) {
      // A missing EXPLICIT target is a hard failure: CI passes a path it
      // expects to exist, and warn-and-continue would let the gate pass
      // without scanning anything (false confidence). Default targets are
      // local conveniences, so those only warn.
      if (explicit.length > 0) {
        console.error(`[FAIL] scan target not found: ${target}`);
        process.exit(1);
      }
      console.warn(`[warn] scan target not found: ${target}`);
      continue;
    }
    const stat = statSync(target);
    if (stat.isDirectory()) {
      allFindings.push(...scanDirectory(target));
    } else if (stat.isFile()) {
      allFindings.push(...scanFile(target));
    }
  }

  // Also scan any locally-built Docker images referenced by compose. Compose
  // names images <project>-<service> (this checkout: `promptpay-*`); older
  // local builds used `waitlayer-*`. Missing images are skipped.
  const imageNames = process.env.SCAN_IMAGE_NAMES
    ? process.env.SCAN_IMAGE_NAMES.split(/\s+/).filter(Boolean)
    : ['promptpay-api', 'promptpay-web', 'waitlayer-api', 'waitlayer-web'];
  for (const image of imageNames) {
    allFindings.push(...scanDockerImageHistory(image));
  }

  if (allFindings.length > 0) {
    console.error('[FAIL] Potential secrets found in build artifacts:');
    for (const finding of allFindings) {
      console.error(`  - ${finding.path ?? finding.image}: ${finding.pattern}`);
    }
    process.exit(1);
  }

  console.log('[PASS] No signing secrets detected in scanned build artifacts.');
}

main();

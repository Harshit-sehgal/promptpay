#!/usr/bin/env node
/**
 * Enforce a license allow/deny policy (P1.22).
 *
 * The CI `security` job runs this after `pnpm licenses list`. It hard-fails the
 * release on licenses that are incompatible with a proprietary, non-distributing
 * SaaS (network/distribution copyleft and non-commercial). All other licenses
 * are permitted but reported so operators keep visibility.
 *
 * Rationale for the allow/deny split (documented decision, 2026-07-20):
 *  - DENY: AGPL (network copyleft — fatal for a hosted service), GPL (strong
 *    copyleft if the binary is ever distributed), SSPL (source-availability
 *    restriction incompatible with proprietary operation), OSL (open software
 *    license copyleft), CC-BY-NC (non-commercial — cannot be used commercially).
 *  - ALLOW (reviewed): LGPL / MPL / CC-BY / Artistic / Python / FSL / Unlicense
 *    / WTFPL / BlueOak / 0BSD / MIT-0 etc. are acceptable for a service that does
 *    NOT distribute its own source; LGPL/MPL are library/file-level copyleft
 *    that do not infect the server. `Unknown` is surfaced as a warning so it can
 *    be triaged, but does not hard-fail (a missing SPDX field is common and not
 *    itself a license violation).
 *
 * Dual-licensed packages (e.g. "(MIT OR CC0-1.0)") are accepted if ANY of their
 * options is acceptable.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const DENY = [
  /^AGPL/i,
  /^GPL-/i, // matches GPL-2.0 / GPL-3.0 — but NOT LGPL (starts with L)
  /^SSPL/i,
  /^OSL-/i,
  /^CC-BY-NC/i,
];

// Licenses we explicitly accept for a hosted SaaS (visibility only).
const ACCEPTED = [
  /^LGPL-/i,
  /^MPL-/i,
  /^CC-BY-/i,
  /^Artistic-/i,
  /^Python-/i,
  /^FSL-/i,
  /^BlueOak/i,
  /^Unlicense/i,
  /^WTFPL/i,
  /^0BSD/i,
  /^MIT/i,
  /^ISC/i,
  /^BSD-/i,
  /^Apache-/i,
  /^CC0-/i,
  /^MPL/i,
  /^(MIT|BSD|Apache)/i,
];

function classify(license) {
  if (!license || license === 'Unknown') return 'unknown';
  const parts = license
    .split(/\s+(OR|AND)\s+/i)
    .map((s) => s.replace(/[()]/g, '').trim())
    .filter(Boolean);
  if (parts.some((p) => DENY.some((re) => re.test(p)))) return 'denied';
  if (parts.some((p) => ACCEPTED.some((re) => re.test(p)))) return 'accepted';
  return 'review'; // known license string we haven't explicitly catalogued
}

let json;
try {
  json = JSON.parse(
    execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' }),
  );
} catch (err) {
  console.error('Failed to read `pnpm licenses list --json`:', err.message);
  process.exit(1);
}

const summary = {};
const offenders = [];
const warnings = [];
for (const [license, pkgs] of Object.entries(json)) {
  const bucket = classify(license);
  summary[license] = (summary[license] || 0) + pkgs.length;
  for (const p of pkgs) {
    const entry = { license, name: p.name, version: p.versions?.[0] };
    if (bucket === 'denied') offenders.push(entry);
    else if (bucket === 'unknown' || bucket === 'review') warnings.push(entry);
  }
}

console.log('License summary:');
for (const [lic, count] of Object.entries(summary).sort()) {
  console.log(`  ${lic}: ${count}`);
}

if (warnings.length) {
  console.warn(
    `\nWARNING: ${warnings.length} package(s) use a license needing review ` +
      `(Unknown / uncatalogued):`,
  );
  for (const w of warnings) console.warn(`  - ${w.name}@${w.version} [${w.license}]`);
}

if (offenders.length) {
  console.error(`\nERROR: ${offenders.length} package(s) use a DENIED license:`);
  for (const o of offenders) console.error(`  - ${o.name}@${o.version} [${o.license}]`);
  console.error(
    '\nPolicy (scripts/check-licenses.mjs): AGPL / GPL / SSPL / OSL / CC-BY-NC are rejected ' +
      'for a proprietary SaaS. Remove or replace the offending dependency, or update the policy ' +
      'with a documented exception.',
  );
  process.exit(1);
}

console.log('\nOK: no denied licenses detected.');
process.exit(0);

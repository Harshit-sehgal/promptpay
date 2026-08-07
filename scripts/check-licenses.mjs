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
import { pathToFileURL } from 'node:url';

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
  /^EPL-/i,
  /^MPL/i,
  /^(MIT|BSD|Apache)/i,
];

// `pnpm licenses list` can only report package.json metadata. These packages
// have been reviewed from the license text shipped in the installed tarball,
// but do not expose a machine-readable SPDX value. Keep overrides exact by
// package + version + reported value so an upgrade or license change returns
// to the fail-closed review queue.
const REVIEWED_PACKAGE_LICENSES = new Map([
  [
    'pause@0.0.1',
    {
      reportedLicense: 'Unknown',
      actualLicense: 'MIT (Readme.md)',
      use: 'Passport runtime stream helper',
    },
  ],
  [
    '@vscode/vsce-sign@2.0.9',
    {
      reportedLicense: 'Unknown',
      actualLicense: 'Microsoft VSCE-SIGN (LICENSE.txt)',
      use: 'VS Code extension signing only',
    },
  ],
  [
    '@vscode/vsce-sign-linux-x64@2.0.6',
    {
      reportedLicense: 'Unknown',
      actualLicense: 'Microsoft VSCE-SIGN (LICENSE.txt)',
      use: 'VS Code extension signing only',
    },
  ],
]);

export function classify(license) {
  if (!license || license === 'Unknown') return 'unknown';
  const parts = license
    .split(/\s+(OR|AND)\s+/i)
    .map((s) => s.replace(/[()]/g, '').trim())
    .filter(Boolean);
  if (parts.some((p) => DENY.some((re) => re.test(p)))) return 'denied';
  if (parts.some((p) => ACCEPTED.some((re) => re.test(p)))) return 'accepted';
  return 'review'; // known license string we haven't explicitly catalogued
}

export function evaluateLicenseInventory(json) {
  const summary = {};
  const offenders = [];
  const unresolvedReviews = [];
  const reviewedOverrides = [];

  for (const [license, pkgs] of Object.entries(json)) {
    const bucket = classify(license);
    summary[license] = (summary[license] || 0) + pkgs.length;
    for (const p of pkgs) {
      const entry = { license, name: p.name, version: p.versions?.[0] };
      if (bucket === 'denied') {
        offenders.push(entry);
        continue;
      }
      if (bucket !== 'unknown' && bucket !== 'review') continue;

      const reviewed = REVIEWED_PACKAGE_LICENSES.get(`${entry.name}@${entry.version}`);
      if (reviewed?.reportedLicense === entry.license) {
        reviewedOverrides.push({ ...entry, ...reviewed });
      } else {
        unresolvedReviews.push(entry);
      }
    }
  }

  return { summary, offenders, unresolvedReviews, reviewedOverrides };
}

function main() {
  let json;
  try {
    json = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' }));
  } catch (err) {
    console.error('Failed to read `pnpm licenses list --json`:', err.message);
    process.exit(1);
  }

  const { summary, offenders, unresolvedReviews, reviewedOverrides } =
    evaluateLicenseInventory(json);

  console.log('License summary:');
  for (const [lic, count] of Object.entries(summary).sort()) {
    console.log(`  ${lic}: ${count}`);
  }

  if (reviewedOverrides.length) {
    console.log(`\nReviewed non-SPDX package license(s):`);
    for (const item of reviewedOverrides) {
      console.log(`  - ${item.name}@${item.version}: ${item.actualLicense}; use=${item.use}`);
    }
  }

  if (unresolvedReviews.length) {
    console.error(
      `\nERROR: ${unresolvedReviews.length} package(s) have an unreviewed license ` +
        `(Unknown / uncatalogued):`,
    );
    for (const item of unresolvedReviews) {
      console.error(`  - ${item.name}@${item.version} [${item.license}]`);
    }
    console.error(
      'Review the license text shipped in the exact package version, then add an exact ' +
        'documented override or an accepted SPDX family. Warnings must not pass a release gate.',
    );
  }

  if (offenders.length) {
    console.error(`\nERROR: ${offenders.length} package(s) use a DENIED license:`);
    for (const o of offenders) console.error(`  - ${o.name}@${o.version} [${o.license}]`);
    console.error(
      '\nPolicy (scripts/check-licenses.mjs): AGPL / GPL / SSPL / OSL / CC-BY-NC are rejected ' +
        'for a proprietary SaaS. Remove or replace the offending dependency, or update the policy ' +
        'with a documented exception.',
    );
  }

  if (offenders.length || unresolvedReviews.length) process.exit(1);

  console.log('\nOK: no denied or unreviewed licenses detected.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

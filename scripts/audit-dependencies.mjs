#!/usr/bin/env node

import { spawnSync } from 'child_process';

const result = spawnSync('pnpm', ['audit', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('pnpm audit did not return valid JSON');
  process.exit(1);
}

const knownDevelopmentOnly = {
  'GHSA-mh99-v99m-4gvg': {
    moduleName: 'brace-expansion',
    severity: 'high',
    paths: new Set([
      'apps__api>@nestjs/cli>fork-ts-checker-webpack-plugin>minimatch>brace-expansion',
    ]),
  },
};

const unexpected = [];
for (const advisory of Object.values(report.advisories ?? {})) {
  const expected = knownDevelopmentOnly[advisory.github_advisory_id];
  const findings = advisory.findings ?? [];
  const advisoryIsExpected =
    expected &&
    advisory.module_name === expected.moduleName &&
    advisory.severity === expected.severity &&
    findings.length > 0 &&
    findings.every(
      (finding) =>
        finding.dev === true &&
        finding.paths?.length > 0 &&
        finding.paths.every((path) => expected.paths.has(path)),
    );

  if (!advisoryIsExpected) unexpected.push(advisory);
}

if (unexpected.length > 0) {
  console.error('Unexpected dependency advisories detected:');
  console.error(JSON.stringify(unexpected, null, 2));
  process.exit(1);
}

if (Object.keys(report.advisories ?? {}).length > 0) {
  console.warn(
    'Only the reviewed dev-only brace-expansion advisory remains; production audit is a separate hard gate.',
  );
} else {
  console.log('No dependency advisories detected.');
}

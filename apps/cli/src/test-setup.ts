import chalk from 'chalk';
import { beforeEach } from 'vitest';

import { CI_ENVIRONMENT_VARIABLES } from './lib/presentation-context';

/**
 * Pin the presentation context to "interactive" for the whole CLI test suite.
 *
 * The same asymmetry chalk has: `canPresentTo()` consults CI environment
 * variables, so a suite run under GitHub Actions would suppress every banner,
 * ad, and completion summary while the identical suite on a laptop rendered
 * them. Tests would then pass in exactly one of the two places.
 *
 * Suites assert the interactive behavior by default; the tests that cover
 * suppression set `ATEVA_ASSUME_HEADLESS` or a non-TTY stream explicitly, which
 * makes the headless expectation visible at the assertion instead of implied by
 * whichever machine ran it.
 */
beforeEach(() => {
  for (const name of CI_ENVIRONMENT_VARIABLES) delete process.env[name];
  delete process.env.ATEVA_ASSUME_HEADLESS;
  if (process.env.TERM === 'dumb') delete process.env.TERM;
  // Vitest captures stdio, so the real streams report `isTTY === undefined`
  // regardless of the host terminal. Pin both to attached for the same reason
  // as the environment variables above.
  process.stdout.isTTY = true;
  process.stderr.isTTY = true;
});

/**
 * Pin colour off for the whole CLI test suite.
 *
 * `chalk` decides at import time whether to emit ANSI codes, based on whether
 * stdout is a TTY. That made the command tests environment-dependent: they
 * passed in CI (no TTY, so plain text) and failed on a developer machine (TTY,
 * so `Available:  €1.25` came back as `Available:  \x1b[32m\x1b[1m€1.25…`).
 *
 * Assertions on rendered CLI output should compare against what the user reads,
 * not against whichever escape sequences the current terminal happens to
 * trigger, so colour is disabled here rather than stripped at each call site.
 */
chalk.level = 0;

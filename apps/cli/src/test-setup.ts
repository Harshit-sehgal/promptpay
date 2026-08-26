import chalk from 'chalk';

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

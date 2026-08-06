#!/usr/bin/env node
// Adversarial fixture: floods stdout beyond the 2 MiB cap. Must be killed by
// the runner and reported as an output-cap violation, not buffered forever.
process.stdout.write('A'.repeat(3 * 1024 * 1024));
process.stdout.write('\n');
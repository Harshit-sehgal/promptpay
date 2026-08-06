#!/usr/bin/env node
// Safe child fixture: it emits no output and contains no provider payload.
const mode = process.argv[2];
if (mode === 'crash') process.exit(17);
process.exit(0);

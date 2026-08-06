#!/usr/bin/env node
// Disposable fixture that spawns a long-lived grandchild inheriting stdout.
// The parent exits successfully, but the grandchild keeps the stdout pipe
// open. The runner must terminate the whole process group on timeout — if it
// only killed the direct child, the run would hang past the deadline.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const pidFile = process.env.SCENARIO_GRANDCHILD_PID_FILE;
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'inherit',
});
grandchild.on('spawn', () => {
  if (pidFile) fs.writeFileSync(pidFile, String(grandchild.pid));
  const event = {
    eventId: 'group-leak-session',
    eventType: 'session.started',
    mode: 'sandbox',
    hasCashValue: false,
  };
  process.stdout.write(`${JSON.stringify([event])}\n`);
  process.exit(0);
});
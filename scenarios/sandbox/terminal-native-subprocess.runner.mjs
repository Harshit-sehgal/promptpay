#!/usr/bin/env node
import { spawn } from 'node:child_process';

const mode = process.argv[2] === 'crash' ? 'crash' : 'success';
const child = spawn(
  process.execPath,
  ['scenarios/sandbox/terminal-native-subprocess.child.mjs', mode],
  { cwd: process.cwd(), shell: false, stdio: ['ignore', 'ignore', 'ignore'] },
);
const exitCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error('child fixture timed out'));
  }, 2_000);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve(code ?? 1);
  });
});
const failed = exitCode !== 0;
const events = [
  { eventId: 'native-session-1', eventType: 'session.started' },
  { eventId: 'native-task-1', eventType: 'task.created' },
  {
    eventId: failed ? 'native-task-failed-1' : 'native-task-completed-1',
    eventType: failed ? 'task.failed' : 'task.completed',
  },
  { eventId: 'native-session-ended-1', eventType: 'session.ended' },
];
process.stdout.write(`${JSON.stringify(events)}\n`);

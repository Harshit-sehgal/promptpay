#!/usr/bin/env node
// Adversarial fixture: emits a trace containing a planted JWT + Bearer token.
// The hardening canaries must flag the run BEFORE any report is built.
const leak = {
  eventId: 'privacy-leak-1',
  eventType: 'session.started',
  mode: 'sandbox',
  hasCashValue: false,
  authHeader: 'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.abc123signature',
};
process.stdout.write(`${JSON.stringify([leak])}\n`);
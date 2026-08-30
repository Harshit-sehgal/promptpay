import { describe, expect, it } from 'vitest';

import { canPresentTo, isHeadlessEnvironment, isInteractiveStream } from './presentation-context';

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe('isHeadlessEnvironment', () => {
  it('treats a bare interactive shell as attended', () => {
    expect(isHeadlessEnvironment({})).toBe(false);
    expect(isHeadlessEnvironment({ TERM: 'xterm-256color', SHELL: '/bin/bash' })).toBe(false);
  });

  it('detects the CI providers a developer machine never sets', () => {
    expect(isHeadlessEnvironment({ CI: 'true' })).toBe(true);
    expect(isHeadlessEnvironment({ GITHUB_ACTIONS: 'true' })).toBe(true);
    expect(isHeadlessEnvironment({ GITLAB_CI: 'true' })).toBe(true);
    expect(isHeadlessEnvironment({ JENKINS_URL: 'https://ci.example.test' })).toBe(true);
    expect(isHeadlessEnvironment({ BUILDKITE: '1' })).toBe(true);
  });

  it('does not fire on the falsy spellings CI runners use to opt out', () => {
    // `CI=false` and `CI=0` are how a job declares it is NOT a CI context.
    // Reading presence alone would make those unrecoverable.
    expect(isHeadlessEnvironment({ CI: 'false' })).toBe(false);
    expect(isHeadlessEnvironment({ CI: '0' })).toBe(false);
    expect(isHeadlessEnvironment({ CI: '' })).toBe(false);
  });

  it('treats a dumb terminal as unable to present', () => {
    expect(isHeadlessEnvironment({ TERM: 'dumb' })).toBe(true);
  });

  it('honors the explicit override so the behavior is reachable from a real shell', () => {
    expect(isHeadlessEnvironment({ ATEVA_ASSUME_HEADLESS: '1' })).toBe(true);
  });
});

describe('isInteractiveStream', () => {
  it('requires an attached terminal', () => {
    expect(isInteractiveStream(tty)).toBe(true);
    expect(isInteractiveStream(pipe)).toBe(false);
    // A redirected stream reports `undefined`, not `false`.
    expect(isInteractiveStream({})).toBe(false);
  });
});

describe('canPresentTo', () => {
  it('requires BOTH an attached terminal and a non-CI environment', () => {
    expect(canPresentTo(tty, {})).toBe(true);
    // A CI runner can still allocate a pseudo-TTY, so the TTY check alone is
    // not sufficient — this is the case that put ads into build logs.
    expect(canPresentTo(tty, { CI: 'true' })).toBe(false);
    // And a piped stream on a developer laptop has no reader either.
    expect(canPresentTo(pipe, {})).toBe(false);
    expect(canPresentTo(pipe, { CI: 'true' })).toBe(false);
  });
});

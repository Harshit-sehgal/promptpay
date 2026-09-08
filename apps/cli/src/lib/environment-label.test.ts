import { afterEach, describe, expect, it, vi } from 'vitest';

import { printSandboxBanner } from './environment-label';

function output(isTTY = true) {
  return {
    value: '',
    isTTY,
    write(chunk: string) {
      this.value += chunk;
      return true;
    },
  };
}

describe('printSandboxBanner', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('trusts the API-confirmed sandbox marker even when the local marker is absent', async () => {
    vi.stubEnv('ATEVA_ENVIRONMENT_KIND', '');
    const sink = output();

    await printSandboxBanner(
      {
        getEnvironmentIdentity: vi.fn().mockResolvedValue({
          environmentKind: 'sandbox',
          environmentId: 'sandbox-run',
        }),
      },
      sink,
    );

    expect(sink.value).toContain('SANDBOX');
    expect(sink.value).toContain('no cash value');
  });

  it('reports an explicit local/server environment mismatch', async () => {
    vi.stubEnv('ATEVA_ENVIRONMENT_KIND', 'sandbox');
    const sink = output();

    await printSandboxBanner(
      {
        getEnvironmentIdentity: vi.fn().mockResolvedValue({
          environmentKind: 'production',
          environmentId: 'prod',
        }),
      },
      sink,
    );

    expect(sink.value).toContain('ENVIRONMENT MISMATCH');
    expect(sink.value).toContain('client=sandbox server=production');
  });

  it('withholds the decorative sandbox badge from a non-interactive stream', async () => {
    vi.stubEnv('ATEVA_ENVIRONMENT_KIND', '');
    const sink = output(false);

    await printSandboxBanner(
      {
        getEnvironmentIdentity: vi.fn().mockResolvedValue({
          environmentKind: 'sandbox',
          environmentId: 'sandbox-run',
        }),
      },
      sink,
    );

    expect(sink.value).toBe('');
  });

  it('withholds the sandbox badge under CI even on an attached terminal', async () => {
    vi.stubEnv('ATEVA_ENVIRONMENT_KIND', '');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    const sink = output(true);

    await printSandboxBanner(
      {
        getEnvironmentIdentity: vi.fn().mockResolvedValue({
          environmentKind: 'sandbox',
          environmentId: 'sandbox-run',
        }),
      },
      sink,
    );

    expect(sink.value).toBe('');
  });

  it('still reports an environment mismatch when nobody is watching', async () => {
    // A mismatch is a misconfiguration, not decoration: an unattended run is
    // exactly when the operator needs it in the log.
    vi.stubEnv('ATEVA_ENVIRONMENT_KIND', 'sandbox');
    const sink = output(false);

    await printSandboxBanner(
      {
        getEnvironmentIdentity: vi.fn().mockResolvedValue({
          environmentKind: 'production',
          environmentId: 'prod',
        }),
      },
      sink,
    );

    expect(sink.value).toContain('ENVIRONMENT MISMATCH');
  });
});

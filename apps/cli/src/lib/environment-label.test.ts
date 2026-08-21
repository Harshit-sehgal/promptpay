import { afterEach, describe, expect, it, vi } from 'vitest';

import { printSandboxBanner } from './environment-label';

function output() {
  return {
    value: '',
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
});

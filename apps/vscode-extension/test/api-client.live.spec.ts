import { beforeAll, describe, expect, it, vi } from 'vitest';

const mockSecrets: Record<string, string> = {};
const mockConfig: Record<string, unknown> = {
  apiUrl: 'http://localhost:4002/api/v1',
};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def?: unknown) => (mockConfig[key] !== undefined ? mockConfig[key] : def),
      update: vi.fn(async (key: string, value: unknown) => {
        mockConfig[key] = value;
      }),
      has: vi.fn(() => true),
    }),
  },
  env: { machineId: 'live-smoke-machine-id' },
  window: {
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

import { ApiClient } from '../src/api-client';
import { ConfigurationManager } from '../src/config';

class FakeSecretStorage {
  async get(key: string): Promise<string | undefined> {
    return mockSecrets[key];
  }
  async store(key: string, value: string): Promise<void> {
    mockSecrets[key] = value;
  }
  async delete(key: string): Promise<void> {
    delete mockSecrets[key];
  }
}

async function createDeveloper(): Promise<{
  email: string;
  accessToken: string;
  refreshToken: string;
}> {
  const email = `vscode-live-${Date.now()}@waitlayer.local`;
  const password = 'TestPass123!';
  const signupRes = await fetch('http://localhost:4002/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      role: 'developer',
      name: 'VS Code Live Smoke',
      country: 'US',
      ageConfirmed: true,
      termsAccepted: true,
      policyVersion: '2026-07-01',
    }),
  });
  if (!signupRes.ok) {
    throw new Error(`Signup failed: ${signupRes.status} ${await signupRes.text()}`);
  }
  const body = (await signupRes.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  return { email, ...body };
}

describe('ApiClient live smoke against standalone API', () => {
  beforeAll(async () => {
    const tokens = await createDeveloper();
    mockSecrets['waitlayer.authTokens'] = JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  });

  it('fetches developer balance from the live API', async () => {
    const client = new ApiClient(new ConfigurationManager(new FakeSecretStorage() as any));
    const balance = await client.getBalance();
    expect(balance).toHaveProperty('available');
    expect(balance).toHaveProperty('pending');
    expect(balance).toHaveProperty('total');
    expect(balance).toHaveProperty('paidOut');
    expect(typeof balance.available.amountMinor).toBe('number');
    expect(balance.available.amountMinor).toBe(0);
    expect(typeof balance.available.currency).toBe('string');
  });
});

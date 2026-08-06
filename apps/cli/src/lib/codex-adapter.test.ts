import { describe, expect, it } from 'vitest';

import {
  adaptCodexHook,
  CODEX_ADAPTER_VERSION,
  getCodexCapabilityStatus,
  isCodexNativeIntegrationTrusted,
} from './codex-adapter';

describe('Codex adapter', () => {
  it('reports native integration as supported but unverified until explicit trust', () => {
    expect(getCodexCapabilityStatus('/home/user/.codex/config.json')).toEqual({
      provider: 'codex_cli',
      adapterVersion: CODEX_ADAPTER_VERSION,
      supported: true,
      trustStatus: 'unverified',
      reason: expect.stringContaining('trust review'),
      configPath: '/home/user/.codex/config.json',
    });
    expect(isCodexNativeIntegrationTrusted()).toBe(false);
  });

  it('projects official-shaped payloads without retaining sensitive fields', () => {
    const payload = {
      prompt: 'private prompt',
      command: 'cat secret.txt',
      transcript_path: '/home/user/transcript.jsonl',
    };
    const result = adaptCodexHook('SessionStart', payload);
    expect(result).toMatchObject({
      supported: true,
      providerEvent: 'SessionStart',
      adapterVersion: CODEX_ADAPTER_VERSION,
      input: {},
    });
    expect(JSON.stringify(result)).not.toContain('private prompt');
    expect(JSON.stringify(result)).not.toContain('secret.txt');
    expect(JSON.stringify(result)).not.toContain('transcript');
  });
});

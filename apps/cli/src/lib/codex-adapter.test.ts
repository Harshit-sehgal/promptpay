import { describe, expect, it } from 'vitest';

import {
  adaptCodexHook,
  CODEX_ADAPTER_VERSION,
  getCodexCapabilityStatus,
  isCodexNativeIntegrationTrusted,
} from './codex-adapter';

describe('Codex adapter', () => {
  it('reports native integration as unsupported and unverified', () => {
    expect(getCodexCapabilityStatus('/home/user/.codex/config.json')).toEqual({
      provider: 'codex_cli',
      adapterVersion: CODEX_ADAPTER_VERSION,
      supported: false,
      trustStatus: 'unverified',
      reason: expect.stringContaining('not verified'),
      configPath: '/home/user/.codex/config.json',
    });
    expect(isCodexNativeIntegrationTrusted()).toBe(false);
  });

  it('does not inspect or retain an unverified provider payload', () => {
    const payload = {
      prompt: 'private prompt',
      command: 'cat secret.txt',
      transcript_path: '/home/user/transcript.jsonl',
    };
    const result = adaptCodexHook('SessionStart', payload);
    expect(result).toEqual({
      supported: false,
      adapterVersion: CODEX_ADAPTER_VERSION,
      reason: expect.stringContaining('unavailable'),
    });
    expect(JSON.stringify(result)).not.toContain('private prompt');
    expect(JSON.stringify(result)).not.toContain('secret.txt');
    expect(JSON.stringify(result)).not.toContain('transcript');
  });
});

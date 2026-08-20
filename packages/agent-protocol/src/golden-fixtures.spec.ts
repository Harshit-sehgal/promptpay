import { describe, expect, it } from 'vitest';

import {
  AGENT_GOLDEN_FIXTURES,
  loadGoldenAgentFixtures,
  sanitizeHookPayload,
  scanForbiddenAgentFields,
} from './index';

describe('@ateva/agent-protocol golden fixtures (WL-022)', () => {
  it('covers Claude, Codex, wrapper, and VS Code providers', () => {
    expect(AGENT_GOLDEN_FIXTURES.map((fixture) => fixture.provider)).toEqual([
      'claude_code',
      'codex_cli',
      'generic_wrapper',
      'vscode',
    ]);
  });

  it('normalizes every fixture to exactly its declared allowlisted metadata', () => {
    for (const fixture of loadGoldenAgentFixtures()) {
      expect(sanitizeHookPayload(fixture.provider, fixture.providerEvent, fixture.payload)).toEqual(
        {
          provider: fixture.provider,
          providerEvent: fixture.providerEvent,
          metadata: fixture.expectedMetadata,
        },
      );
    }
  });

  it('contains no forbidden fields or sensitive values in fixture inputs or outputs', () => {
    for (const fixture of loadGoldenAgentFixtures()) {
      expect(scanForbiddenAgentFields(fixture.payload)).toEqual([]);
      expect(
        scanForbiddenAgentFields(
          sanitizeHookPayload(fixture.provider, fixture.providerEvent, fixture.payload),
        ),
      ).toEqual([]);
      expect(JSON.stringify(fixture)).not.toMatch(
        /prompt|command|terminal|source|path|secret|token/i,
      );
    }
  });

  it('returns stable fixture identity and ordering', () => {
    expect(loadGoldenAgentFixtures().map((fixture) => fixture.id)).toEqual([
      'claude-code-tool-completed',
      'codex-session-completed',
      'generic-wrapper-process-ended',
      'vscode-surface-visible',
    ]);
  });
});

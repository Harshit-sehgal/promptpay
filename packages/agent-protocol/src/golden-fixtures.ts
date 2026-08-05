import type { AgentProvider, CanonicalAgentMetadata, ProviderFixture } from './index';

/**
 * Provider-shaped inputs used by the protocol contract gate. These payloads
 * intentionally contain only safe, coarse fields: real provider hook payloads
 * must be projected by their adapter before they reach this boundary.
 */
export type GoldenAgentFixture = ProviderFixture & {
  expectedMetadata: CanonicalAgentMetadata;
};

export const AGENT_GOLDEN_FIXTURES: readonly GoldenAgentFixture[] = [
  {
    id: 'claude-code-tool-completed',
    provider: 'claude_code',
    providerEvent: 'PostToolUse',
    payload: { toolFamily: 'test', success: true, elapsedDurationBucket: '5_30s' },
    expectedMetadata: { toolFamily: 'test', success: true, elapsedDurationBucket: '5_30s' },
  },
  {
    id: 'codex-session-completed',
    provider: 'codex_cli',
    providerEvent: 'SessionEnd',
    payload: { success: true, executableFamily: 'codex_cli' },
    expectedMetadata: { success: true, executableFamily: 'codex_cli' },
  },
  {
    id: 'generic-wrapper-process-ended',
    provider: 'generic_wrapper',
    providerEvent: 'session.ended',
    payload: { executableFamily: 'other', exitCodeCategory: 'success', success: true },
    expectedMetadata: { executableFamily: 'other', exitCodeCategory: 'success', success: true },
  },
  {
    id: 'vscode-surface-visible',
    provider: 'vscode',
    providerEvent: 'surface.visible',
    payload: { operatingSystem: 'linux', success: true },
    expectedMetadata: { operatingSystem: 'linux', success: true },
  },
] as const;

export function loadGoldenAgentFixtures(): readonly GoldenAgentFixture[] {
  return AGENT_GOLDEN_FIXTURES;
}

export function goldenFixtureProviders(): readonly AgentProvider[] {
  return AGENT_GOLDEN_FIXTURES.map((fixture) => fixture.provider);
}

export const CODEX_ADAPTER_VERSION = 'codex-cli-unverified-0.0.1';

export type CodexTrustStatus = 'unverified' | 'trusted' | 'managed' | 'disabled';

export type CodexCapabilityStatus = {
  provider: 'codex_cli';
  adapterVersion: string;
  supported: false;
  trustStatus: CodexTrustStatus;
  reason: string;
  configPath?: string;
};

export type CodexAdapterResult = {
  supported: false;
  adapterVersion: string;
  reason: string;
};

/**
 * Codex is intentionally fail-closed until an authoritative native hook
 * schema and trust contract exist. Do not interpret arbitrary Codex-shaped
 * JSON as lifecycle evidence or guess a provider configuration format.
 */
export function getCodexCapabilityStatus(configPath?: string): CodexCapabilityStatus {
  return {
    provider: 'codex_cli',
    adapterVersion: CODEX_ADAPTER_VERSION,
    supported: false,
    trustStatus: 'unverified',
    reason:
      'No authoritative Codex CLI lifecycle-hook schema or trust contract is available; native integration is not verified and remains disabled',
    ...(configPath ? { configPath } : {}),
  };
}

/**
 * Return a diagnostic result without retaining, inspecting, or normalizing the
 * raw payload. This function is deliberately not a lifecycle parser.
 */
export function adaptCodexHook(_providerEvent: string, _input: unknown): CodexAdapterResult {
  return {
    supported: false,
    adapterVersion: CODEX_ADAPTER_VERSION,
    reason:
      'Codex native hook ingestion is unavailable until an authoritative hook schema and trust contract is available; native support is not verified',
  };
}

export function isCodexNativeIntegrationTrusted(): false {
  return false;
}

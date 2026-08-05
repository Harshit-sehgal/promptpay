import { AgentProvider } from '@waitlayer/agent-protocol';

import { sendAgentEventToBridge } from '../lib/agent-bridge';
import { adaptClaudeCodeHook } from '../lib/claude-code-adapter';
import { adaptCodexHook } from '../lib/codex-adapter';
import { getCredentials, getDeviceEventSecret } from '../lib/credentials';
import { HookConfigManager } from '../lib/hook-config';
import { maxHookInputBytes, normalizeHookEvent, readHookInputJson } from '../lib/hook-ingestion';

export type HookIngestOptions = {
  provider?: string;
  event?: string;
  input?: string;
};

const PROVIDERS = new Set<AgentProvider>([
  'claude_code',
  'codex_cli',
  'aider',
  'generic_wrapper',
  'vscode',
  'unknown',
]);

/**
 * Ingest one provider hook without making a network request. Hook failures are
 * intentionally non-blocking: provider commands must continue even when
 * WaitLayer is not installed, logged in, or locally available.
 */
export async function runHookIngest(options: HookIngestOptions): Promise<boolean> {
  const provider = options.provider?.trim() as AgentProvider | undefined;
  const providerEvent = options.event?.trim();
  if (!provider || !PROVIDERS.has(provider) || !providerEvent) return false;

  const raw = options.input ?? (await readStdin());
  const input = readHookInputJson(raw);
  if (!input) return false;

  try {
    const credentials = await getCredentials();
    const deviceId = credentials?.deviceUUID;
    if (!credentials?.installationId || !deviceId) return false;
    const integrationProvider = provider === 'claude_code' ? 'claude-code' : null;
    if (integrationProvider && new HookConfigManager().isDisabled(integrationProvider)) return false;
    if (provider === 'codex_cli') {
      adaptCodexHook(providerEvent, input);
      return false;
    }
    const adapted = provider === 'claude_code' ? adaptClaudeCodeHook(providerEvent, input) : null;
    if (provider === 'claude_code' && !adapted) return false;
    const event = normalizeHookEvent({
      provider,
      providerEvent: adapted?.providerEvent ?? providerEvent,
      input: adapted?.input ?? input,
      installationId: credentials.installationId,
      deviceId,
      identifierSecret: await getDeviceEventSecret(),
      ...(adapted?.adapterVersion ? { adapterVersion: adapted.adapterVersion } : {}),
      environmentId: process.env.WAITLAYER_ENVIRONMENT_ID ?? 'local',
    });
    if (!event) return false;

    await sendAgentEventToBridge({
      installationId: credentials.installationId,
      deviceId,
      event,
    });
    return true;
  } catch {
    // Never print provider payloads or block the provider hook on local
    // credential, keychain, socket, or spool failures.
    return false;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let raw = '';
    let bytes = 0;
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      bytes += Buffer.byteLength(text, 'utf8');
      if (bytes <= maxHookInputBytes()) raw += text;
      if (bytes > maxHookInputBytes()) {
        cleanup();
        resolve('');
      }
    };
    const onEnd = () => {
      cleanup();
      resolve(raw);
    };
    const onError = () => {
      cleanup();
      resolve('');
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
    };
    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    process.stdin.resume();
  });
}

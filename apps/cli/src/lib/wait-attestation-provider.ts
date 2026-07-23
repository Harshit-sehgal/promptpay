import { WaitAssertionProvider } from '@waitlayer/shared';

/**
 * Adapter for a separately operated independent-proof service. The CLI never
 * manufactures an assertion: it hands the nonce to the configured provider
 * over HTTPS and accepts only that provider's signed response.
 */
export function createCliWaitAssertionProvider(
  env: NodeJS.ProcessEnv = process.env,
): WaitAssertionProvider | null {
  const provider = env.WAITLAYER_ATTESTATION_PROVIDER?.trim();
  const url = env.WAITLAYER_ATTESTATION_PROVIDER_URL?.trim();
  if (!provider || !url) return null;
  if (!/^https:\/\//i.test(url) && env.NODE_ENV === 'production') {
    throw new Error('WAITLAYER_ATTESTATION_PROVIDER_URL must use HTTPS in production');
  }
  return {
    provider,
    async obtainAssertion(input) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, provider }),
      });
      if (!response.ok)
        throw new Error(`Attestation provider rejected the wait (${response.status})`);
      const body = (await response.json()) as { assertion?: unknown };
      if (typeof body.assertion !== 'string' || body.assertion.length < 32) {
        throw new Error('Attestation provider returned no usable assertion');
      }
      return body.assertion;
    },
  };
}

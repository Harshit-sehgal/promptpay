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
  // Validate the URL up front so a typo'd provider config fails fast with a
  // clear message instead of a confusing fetch error inside the wait loop.
  try {
    new URL(url);
  } catch {
    throw new Error(`WAITLAYER_ATTESTATION_PROVIDER_URL is not a valid URL: "${url}"`);
  }
  if (!/^https:\/\//i.test(url) && env.NODE_ENV === 'production') {
    throw new Error('WAITLAYER_ATTESTATION_PROVIDER_URL must use HTTPS in production');
  }
  // A hung attestation provider must not hang the wait loop forever; 10s
  // covers a cold TLS handshake plus signing round-trip with room to spare.
  const timeoutMs = 10_000;
  return {
    provider,
    async obtainAssertion(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, provider }),
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Attestation provider rejected the wait (${response.status})`);
        const body = (await response.json()) as { assertion?: unknown };
        if (typeof body.assertion !== 'string' || body.assertion.length < 32) {
          throw new Error('Attestation provider returned no usable assertion');
        }
        return body.assertion;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Attestation provider timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

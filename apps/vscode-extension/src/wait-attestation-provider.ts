import * as vscode from 'vscode';

import { WaitAssertionProvider } from '@waitlayer/shared';

/** A configured HTTPS bridge to an independently operated attester. The
 * extension sends a server-issued nonce; it never possesses signing material. */
export function createVsCodeWaitAssertionProvider(): WaitAssertionProvider | null {
  const config = vscode.workspace.getConfiguration('waitlayer');
  const provider = config.get<string>('attestationProvider')?.trim();
  const url = config.get<string>('attestationProviderUrl')?.trim();
  if (!provider || !url) return null;
  if (!/^https:\/\//i.test(url)) {
    throw new Error('WaitLayer attestation provider URL must use HTTPS');
  }
  return {
    provider,
    async obtainAssertion(input) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(`Wait attestation provider rejected the operation (${response.status})`);
      const responseBody = (await response.json()) as { assertion?: unknown };
      if (typeof responseBody.assertion !== 'string' || responseBody.assertion.length < 32) {
        throw new Error('Wait attestation provider returned no usable assertion');
      }
      return responseBody.assertion;
    },
  };
}

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { type StandardWebhookHeaders, verifyStandardWebhookSignature } from './standard-webhooks';

const RAW_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes
const SECRET = `whsec_${RAW_KEY.toString('base64')}`;

function sign(secret: string, id: string, timestamp: string, body: string): string {
  const bare = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(bare, 'base64');
  const signedContent = `${id}.${timestamp}.${body}`;
  return `v1,${createHmac('sha256', key).update(signedContent).digest('base64')}`;
}

function headers(id: string, timestamp: string, signature: string): StandardWebhookHeaders {
  return {
    'webhook-id': id,
    'webhook-signature': signature,
    'webhook-timestamp': timestamp,
  };
}

describe('verifyStandardWebhookSignature', () => {
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_1' } });

  it('accepts a correctly signed delivery', () => {
    const sig = sign(SECRET, id, timestamp, body);
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: SECRET,
        headers: headers(id, timestamp, sig),
      }),
    ).toBe(true);
  });

  it('accepts a bare (non-whsec-prefixed) secret', () => {
    const bareSecret = RAW_KEY.toString('base64');
    const sig = sign(bareSecret, id, timestamp, body);
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: bareSecret,
        headers: headers(id, timestamp, sig),
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(SECRET, id, timestamp, body);
    expect(
      verifyStandardWebhookSignature({
        payload: body.replace('pay_1', 'pay_2'),
        secret: SECRET,
        headers: headers(id, timestamp, sig),
      }),
    ).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = sign(SECRET, id, timestamp, body);
    const wrongSecret = `whsec_${Buffer.from('another-32-byte-key-aaaaaaaaaaaaaaaa', 'utf8').toString('base64')}`;
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: wrongSecret,
        headers: headers(id, timestamp, sig),
      }),
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    const sig = sign(SECRET, id, timestamp, body);
    const full = headers(id, timestamp, sig);
    for (const key of ['webhook-id', 'webhook-signature', 'webhook-timestamp'] as const) {
      expect(
        verifyStandardWebhookSignature({
          payload: body,
          secret: SECRET,
          headers: { ...full, [key]: '' },
        }),
      ).toBe(false);
    }
  });

  it('rejects an expired delivery', () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const sig = sign(SECRET, id, old, body);
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: SECRET,
        headers: headers(id, old, sig),
      }),
    ).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const sig = sign(SECRET, id, 'not-a-number', body);
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: SECRET,
        headers: headers(id, 'not-a-number', sig),
      }),
    ).toBe(false);
  });

  it('rejects a non-v1 signature version', () => {
    const bare = SECRET.slice('whsec_'.length);
    const key = Buffer.from(bare, 'base64');
    const signedContent = `${id}.${timestamp}.${body}`;
    const other = createHmac('sha256', key).update(signedContent).digest('base64');
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: SECRET,
        headers: headers(id, timestamp, `v2,${other}`),
      }),
    ).toBe(false);
  });

  it('accepts a delivery when any one of several signatures matches (rotation)', () => {
    const sig = sign(SECRET, id, timestamp, body);
    const bogus = 'v1,AAAA';
    expect(
      verifyStandardWebhookSignature({
        payload: body,
        secret: SECRET,
        headers: headers(id, timestamp, `${bogus} ${sig}`),
      }),
    ).toBe(true);
  });
});

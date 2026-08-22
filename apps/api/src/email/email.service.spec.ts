import { describe, expect, it } from 'vitest';

import { EmailService } from './email.service';

/**
 * The CTA link is the highest-value target in this whole module: password-reset
 * and email-verification messages are the two that carry a token, and both put
 * a URL into an `href`. The layout used to interpolate that URL raw, on the
 * documented grounds that every builder constructs it from the configured web
 * origin with an encoded token. That was true — but it was enforced by a
 * comment, and a comment does not fail a build.
 */
describe('EmailService CTA link safety', () => {
  function service(webBaseUrl = 'https://www.ateva.test') {
    const config = {
      get: (key: string, fallback?: unknown) =>
        key === 'WEB_BASE_URL' ? webBaseUrl : key === 'EMAIL_DRIVER' ? 'console' : fallback,
    };
    return new EmailService(config as never) as unknown as {
      layout: (t: string, b: string, u: string | null, l: string | null, f: string) => string;
      buildEmailVerification: (to: string, token: string) => { html: string };
      buildPasswordReset: (to: string, token: string) => { html: string };
    };
  }

  it('accepts the links the real builders produce', () => {
    const s = service();
    expect(s.buildEmailVerification('u@example.com', 'tok-123').html).toContain(
      'https://www.ateva.test/auth/verify-email?token=tok-123',
    );
    expect(s.buildPasswordReset('u@example.com', 'tok-456').html).toContain(
      'https://www.ateva.test/auth/reset-password?token=tok-456',
    );
  });

  it('refuses a javascript: href', () => {
    // The attack the raw interpolation allowed: a builder passing a URL whose
    // scheme executes when the recipient clicks it.
    const s = service();
    expect(() => s.layout('t', '<p>b</p>', 'javascript:alert(1)', 'Go', 'f')).toThrow(
      /must be http\(s\)/,
    );
  });

  it("refuses a link on someone else's origin", () => {
    // A phishing link inside a genuine, correctly-signed Ateva email.
    const s = service();
    expect(() => s.layout('t', '<p>b</p>', 'https://evil.example/steal', 'Go', 'f')).toThrow(
      /configured web origin/,
    );
  });

  it('refuses a value that is not a URL at all', () => {
    const s = service();
    expect(() => s.layout('t', '<p>b</p>', 'not a url', 'Go', 'f')).toThrow(/valid absolute URL/);
  });

  it('escapes the URL in both the href and the copy-this-link text node', () => {
    // Same-origin but carrying markup: the href is one interpolation point and
    // the "Or copy this link:" paragraph is a TEXT node, where an unescaped
    // `<` injects regardless of how safe the attribute is.
    const s = service();
    const html = s.layout('t', '<p>b</p>', 'https://www.ateva.test/x?a=1&b=<script>', 'Go', 'f');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;');
  });

  it('still renders normally when there is no CTA', () => {
    const s = service();
    const html = s.layout('t', '<p>b</p>', null, null, 'f');
    expect(html).toContain('<p>b</p>');
    expect(html).not.toContain('href=');
  });
});

/**
 * Permanent vs transient provider rejection.
 *
 * Found by actually sending against a live Resend account with an unverified
 * sender domain: every send returned 403, and because the queue treated that
 * the same as an outage it kept the message and retried it — five identical
 * 403s across four minutes, each logged as a retryable failure, none of which
 * could ever have succeeded. The distinction did not exist in the type, so no
 * caller could act on it.
 */
describe('EmailService provider failure classification', () => {
  function resendService() {
    const config = {
      get: (key: string, fallback?: unknown) =>
        key === 'EMAIL_DRIVER'
          ? 'resend'
          : key === 'RESEND_API_KEY'
            ? 're_test_key'
            : key === 'EMAIL_FROM'
              ? 'sender@example.test'
              : key === 'EMAIL_PROVIDER_TIMEOUT_MS'
                ? 5_000
                : fallback,
    };
    return new EmailService(config as never);
  }

  const msg = { to: 'user@example.com', subject: 's', html: '<p>h</p>', text: 't' };

  async function sendWithStatus(status: number) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{}', { status, headers: { 'x-request-id': 'rid' } })) as typeof fetch;
    try {
      return await resendService().send({ ...msg });
    } finally {
      globalThis.fetch = original;
    }
  }

  it('treats a 403 as permanent — an unverified domain refuses identically every time', async () => {
    const res = await sendWithStatus(403);
    expect(res.delivered).toBe(false);
    expect(res.permanent).toBe(true);
  });

  it('treats other 4xx as permanent', async () => {
    for (const status of [400, 401, 404, 422]) {
      expect((await sendWithStatus(status)).permanent).toBe(true);
    }
  });

  it('treats 429 and 408 as transient — both explicitly invite a retry', async () => {
    for (const status of [408, 429]) {
      const res = await sendWithStatus(status);
      expect(res.delivered).toBe(false);
      expect(res.permanent).toBe(false);
    }
  });

  it('treats 5xx as transient — the provider is the one having a problem', async () => {
    for (const status of [500, 502, 503]) {
      expect((await sendWithStatus(status)).permanent).toBe(false);
    }
  });

  it('reports success without marking permanence', async () => {
    const res = await sendWithStatus(200);
    expect(res.delivered).toBe(true);
    expect(res.permanent).toBeFalsy();
  });

  it('marks an invalid recipient permanent — the address will not become valid', async () => {
    const res = await resendService().send({ ...msg, to: 'not-an-email' });
    expect(res.delivered).toBe(false);
    expect(res.permanent).toBe(true);
  });
});

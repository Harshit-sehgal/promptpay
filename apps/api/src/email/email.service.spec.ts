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
  function service(webBaseUrl = 'https://www.waitlayer.test') {
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
      'https://www.waitlayer.test/auth/verify-email?token=tok-123',
    );
    expect(s.buildPasswordReset('u@example.com', 'tok-456').html).toContain(
      'https://www.waitlayer.test/auth/reset-password?token=tok-456',
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

  it('refuses a link on someone else\'s origin', () => {
    // A phishing link inside a genuine, correctly-signed WaitLayer email.
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
    const html = s.layout(
      't',
      '<p>b</p>',
      'https://www.waitlayer.test/x?a=1&b=<script>',
      'Go',
      'f',
    );
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

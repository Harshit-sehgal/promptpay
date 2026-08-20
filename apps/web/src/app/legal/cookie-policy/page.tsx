import type { Metadata } from 'next';
import { LegalDocument, LegalHeading } from '@/components/legal-document';

export const metadata: Metadata = {
  title: 'Cookie Policy — Ateva',
  description:
    'How Ateva uses essential and analytics cookies, and what it deliberately does not do.',
};

export default function CookiePolicyPage() {
  return (
    <LegalDocument title="Cookie Policy" lastUpdated="2026-07-19">
      <p>Ateva uses cookies and similar technologies as described below.</p>

      <LegalHeading>Essential cookies</LegalHeading>
      <p>
        Required to keep you signed in, maintain your session, and enforce security (CSRF/origin
        checks). These cannot be disabled and are set as <code>HttpOnly</code> cookies so
        client-side JavaScript cannot read them.
      </p>

      <LegalHeading>Analytics cookies</LegalHeading>
      <p>
        Used only with your consent to understand how the product is used and to improve it. Managed
        via the cookie banner; you can change your choice at any time from &ldquo;Cookie
        Settings&rdquo; in the footer.
      </p>

      <LegalHeading>What we do NOT do</LegalHeading>
      <p>
        We do not use advertising or third-party ad-network tracking cookies, and we never read your
        code, prompts, or terminal output. See the Privacy Policy for the full data-handling
        summary.
      </p>

      <LegalHeading>Managing cookies</LegalHeading>
      <p>
        Use the cookie banner or your browser settings to clear or block cookies. Disabling
        essential cookies will prevent sign-in.
      </p>
    </LegalDocument>
  );
}

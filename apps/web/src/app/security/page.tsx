'use client';

import { SiteHeader } from '@/components/site-header';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      {/* Main content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-3xl px-5 py-20 sm:px-6 lg:py-24"
      >
        <div className="text-center mb-16">
          <h1 className="mb-4 font-serif text-4xl font-normal leading-[1.15] tracking-[-0.015em] text-surface-950 md:text-[44px]">
            Security & Trust
          </h1>
          <p className="text-surface-500 text-sm">
            How we protect your account, API integrations, and developer environments.
          </p>
        </div>

        <div className="space-y-10">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 font-sans">
              Two-Factor Authentication (2FA)
            </h2>
            <p className="text-surface-500 text-sm leading-relaxed font-light">
              We support standard QR-code based TOTP two-factor authentication. Enabling 2FA is
              highly recommended for all developer accounts. When an operator enables the{' '}
              <code className="text-surface-700">PAYOUT_REQUIRE_2FA</code> policy, 2FA is mandatory
              before requesting any financial payouts. 2FA verification is also integrated into our
              VS Code extension; the CLI prompts for your 2FA code during login when it is required.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 font-sans">
              Data Encryption & Secrets
            </h2>
            <p className="text-surface-500 text-sm leading-relaxed font-light">
              Sensitive fields such as Authenticator secrets and integration tokens are encrypted
              at-rest using AES-256-GCM. Decryption keys are rotated and managed securely in our
              production environment.
            </p>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 font-sans">Secure CLI Credentials</h2>
            <p className="text-surface-500 text-sm leading-relaxed font-light">
              The Ateva CLI securely isolates session tokens locally. Directory structures are
              configured with UNIX file mode permissions `0700` (read/write/search by owner only)
              and credentials files are restricted to `0600` (read/write by owner only), locking out
              unauthorized local processes.
            </p>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 font-sans">
              OAuth & Authentication Integrity
            </h2>
            <p className="text-surface-500 text-sm leading-relaxed font-light">
              Authentication relies on industry-standard JWT token pairs (short-lived access tokens
              and long-lived cryptographically signed refresh tokens). Third-party authentications
              (Google OAuth, GitHub) verify tokens through strict environment checks to prevent
              token manipulation or staging-bypass vulnerabilities.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

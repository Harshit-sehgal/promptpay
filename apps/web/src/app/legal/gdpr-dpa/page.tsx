import type { Metadata } from 'next';
import { LegalDocument, LegalHeading, LegalTable } from '@/components/legal-document';

export const metadata: Metadata = {
  title: 'GDPR Data Processing Agreement — Ateva',
  description:
    'Ateva GDPR DPA — roles, data categories, legal bases, data-subject rights, sub-processors, and retention.',
};

const LEGAL_BASIS_ROWS: string[][] = [
  ['Provide the reward marketplace & ad serving', 'Art. 6(1)(b) — contract'],
  ['Fraud prevention & security', 'Art. 6(1)(f) — legitimate interests'],
  ['Marketing communications (opt-in)', 'Art. 6(1)(a) — consent'],
  ['Legal / tax retention', 'Art. 6(1)(c) — legal obligation'],
];

export default function GdprDpaPage() {
  return (
    <LegalDocument title="GDPR Data Processing Agreement" lastUpdated="2026-07-01">
      <p>
        <strong className="text-surface-900">Controller:</strong> Ateva, Inc. (&ldquo;Ateva&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;)
        <br />
        <strong className="text-surface-900">Effective for:</strong> all users (developers,
        advertisers, and visitors) in the European Economic Area.
      </p>
      <p>
        This DPA forms part of, and is incorporated into, the Ateva Terms of Service. It explains
        how Ateva processes personal data on behalf of, and in relation to, its users, in compliance
        with the EU General Data Protection Regulation (GDPR, Regulation (EU) 2016/679).
      </p>

      <LegalHeading>1. Roles of the Parties</LegalHeading>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          <strong className="text-surface-900">Developer / Advertiser / Visitor</strong> — the{' '}
          <strong className="text-surface-900">data subject</strong> and, where applicable, a{' '}
          <strong className="text-surface-900">controller</strong> of any end-user data they submit.
        </li>
        <li>
          <strong className="text-surface-900">Ateva</strong> — acts as a{' '}
          <strong className="text-surface-900">controller</strong> for account, billing, and service
          operational data, and as a <strong className="text-surface-900">processor</strong> when
          handling data on a customer&rsquo;s behalf under a separate written agreement.
        </li>
      </ul>

      <LegalHeading>2. Categories of Personal Data</LegalHeading>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          Identity: email, display name, country, authentication identifiers (Google / GitHub),
          payout destination.
        </li>
        <li>
          Service telemetry: hashed device fingerprints, hashed IP, ad interaction events, consent
          records.
        </li>
        <li>
          Financial: earnings ledger entries, payout requests (no raw card data is stored by Ateva).
        </li>
      </ul>

      <LegalHeading>3. Purposes &amp; Legal Bases</LegalHeading>
      <LegalTable
        head={['Purpose', 'Legal basis (GDPR Art.)']}
        rows={LEGAL_BASIS_ROWS}
        label="Legal basis for each processing purpose"
      />

      <LegalHeading>4. Data Subject Rights</LegalHeading>
      <p>You may exercise the following rights at any time:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          <strong className="text-surface-900">Access / Portability</strong> — export your data from
          the developer dashboard (<code>POST /developer/export-data</code>) or by request.
        </li>
        <li>
          <strong className="text-surface-900">Rectification</strong> — update profile fields in
          settings.
        </li>
        <li>
          <strong className="text-surface-900">Erasure</strong> — delete your account; Ateva
          anonymizes personal data and revokes active sessions and API keys.
        </li>
        <li>
          <strong className="text-surface-900">Objection / Restriction</strong> — raise it through
          the in-app{' '}
          <a href="/feedback" className="underline">
            feedback form
          </a>
          .
        </li>
      </ul>
      <p>
        We respond to verified requests within <strong className="text-surface-900">30 days</strong>{' '}
        as required by Art. 12.
      </p>

      <LegalHeading>5. Sub-processors</LegalHeading>
      <p>Ateva uses the following categories of sub-processors:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>
          <strong className="text-surface-900">Cloud hosting / database</strong> — PostgreSQL
          hosting provider (EU region).
        </li>
        <li>
          <strong className="text-surface-900">Transactional email</strong> — Resend (or console
          driver in development).
        </li>
        <li>
          <strong className="text-surface-900">Payment processor</strong> — Dodo Payments (Merchant
          of Record for advertiser deposits).
        </li>
        <li>
          <strong className="text-surface-900">Payout providers</strong> — PayPal, Wise, Payoneer,
          Razorpay, as elected by the user. Stripe is currently inactive.
        </li>
      </ul>
      <p>
        Material changes to sub-processors are announced via the changelog and, where required, by
        email.
      </p>

      <LegalHeading>6. International Transfers</LegalHeading>
      <p>
        Where data is transferred outside the EEA, Ateva relies on Standard Contractual Clauses
        (SCCs) and the recipient&rsquo;s adequacy status.
      </p>

      <LegalHeading>7. Security</LegalHeading>
      <p>
        Ateva applies encryption in transit (TLS), TOTP secrets are encrypted at rest, and access is
        guarded by role-based authorization and audit logging.
      </p>

      <LegalHeading>8. Retention</LegalHeading>
      <p>
        Data is retained per category according to the operator-tunable{' '}
        <code>DataRetentionConfig</code> (e.g. webhook events 90 days, audit logs 365 days).
        Anonymized account records are retained only as required for legal/audit purposes.
      </p>

      <LegalHeading>9. Contact</LegalHeading>
      <p>
        Data Protection Officer / privacy requests: submit through the in-app{' '}
        <a href="/feedback" className="underline">
          feedback form
        </a>
        ; a direct mailbox on an Ateva-controlled domain will be published before general
        availability.
      </p>
    </LegalDocument>
  );
}

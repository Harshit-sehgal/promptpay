import type { Metadata } from 'next';
import { LegalDocument, LegalTable } from '@/components/legal-document';

export const metadata: Metadata = {
  title: 'Data Retention Schedule — WaitLayer',
  description: 'How long WaitLayer retains each category of personal data, and why.',
};

const RETENTION_ROWS: string[][] = [
  [
    'Account & profile',
    'Duration of account; purged on account erasure',
    'Soft-deleted, then purged per the erasure job',
  ],
  [
    'Authentication sessions',
    'Access token 15 min; refresh token 30 days',
    'Refresh tokens are revocable server-side',
  ],
  [
    'Consent records',
    'Indefinite (audit)',
    'Append-only; reflects each version you accepted or declined',
  ],
  [
    'Ad / wait-state events',
    'Rolling retention per the retention cron',
    'Aggregated, de-identified analytics may be kept longer',
  ],
  [
    'Ledger & payout records',
    'Retained for financial / regulatory compliance',
    'Immutable financial ledger',
  ],
  [
    'Feedback & false-positive flags',
    'Retained to improve detection quality',
    'Associated with the originating wait event',
  ],
];

export default function DataRetentionPage() {
  return (
    <LegalDocument title="Data Retention Schedule" lastUpdated="2026-07-19">
      <p>
        WaitLayer retains personal data only as long as necessary for the purposes described in the
        Privacy Policy and applicable law.
      </p>

      <LegalTable head={['Data', 'Retention', 'Notes']} rows={RETENTION_ROWS} />

      <p>
        For data-subject requests (access, deletion, portability), contact the operator privacy
        address configured for this deployment. See the GDPR Data Processing Agreement for EU
        processing terms.
      </p>
    </LegalDocument>
  );
}

# Data Retention Schedule

_Last updated 2026-07-19_

WaitLayer retains personal data only as long as necessary for the purposes
described in the Privacy Policy and applicable law.

| Data                            | Retention                                      | Notes                                                       |
| ------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Account & profile               | Duration of account; purged on account erasure | Soft-deleted, then purged per the erasure job               |
| Authentication sessions         | Access token 15 min; refresh token 30 days     | Refresh tokens are revocable server-side                    |
| Consent records                 | Indefinite (audit)                             | Append-only; reflects each version you accepted or declined |
| Ad / wait-state events          | Rolling retention per the retention cron       | Aggregated, de-identified analytics may be kept longer      |
| Ledger & payout records         | Retained for financial / regulatory compliance | Immutable financial ledger                                  |
| Feedback & false-positive flags | Retained to improve detection quality          | Associated with the originating wait event                  |

For data-subject requests (access, deletion, portability), contact the operator
privacy address configured for this deployment. See the GDPR Data Processing
Agreement for EU processing terms.

# WaitLayer — GDPR Data Processing Agreement (DPA)

**Last updated:** 2026-07-01
**Controller:** WaitLayer, Inc. ("WaitLayer", "we", "us")
**Effective for:** all users (developers, advertisers, and visitors) in the European Economic Area.

This DPA forms part of, and is incorporated into, the WaitLayer Terms of
Service. It explains how WaitLayer processes personal data on behalf of, and
in relation to, its users, in compliance with the EU General Data Protection
Regulation (GDPR, Regulation (EU) 2016/679).

## 1. Roles of the Parties

- **Developer / Advertiser / Visitor** — the **data subject** and, where
  applicable, a **controller** of any end-user data they submit.
- **WaitLayer** — acts as a **controller** for account, billing, and service
  operational data, and as a **processor** when handling data on a customer's
  behalf under a separate written agreement.

## 2. Categories of Personal Data

- Identity: email, display name, country, authentication identifiers (Google /
  GitHub), payout destination.
- Service telemetry: hashed device fingerprints, hashed IP, ad interaction
  events, consent records.
- Financial: earnings ledger entries, payout requests (no raw card data is
  stored by WaitLayer).

## 3. Purposes & Legal Bases

| Purpose | Legal basis (GDPR Art.) |
| --- | --- |
| Provide the reward marketplace & ad serving | Art. 6(1)(b) — contract |
| Fraud prevention & security | Art. 6(1)(f) — legitimate interests |
| Marketing communications (opt-in) | Art. 6(1)(a) — consent |
| Legal / tax retention | Art. 6(1)(c) — legal obligation |

## 4. Data Subject Rights

You may exercise the following rights at any time:

- **Access / Portability** — export your data from the developer dashboard
  (`POST /developer/export-data`) or by request.
- **Rectification** — update profile fields in settings.
- **Erasure** — delete your account; WaitLayer anonymizes personal data and
  revokes active sessions and API keys.
- **Objection / Restriction** — contact `privacy@waitlayer.dev`.

We respond to verified requests within **30 days** as required by Art. 12.

## 5. Sub-processors

WaitLayer uses the following categories of sub-processors:

- **Cloud hosting / database** — PostgreSQL hosting provider (EU region).
- **Transactional email** — Resend (or console driver in development).
- **Payout providers** — PayPal, Stripe, Wise, Payoneer, Razorpay, as elected
  by the user.

Material changes to sub-processors are announced via the changelog and, where
required, by email.

## 6. International Transfers

Where data is transferred outside the EEA, WaitLayer relies on Standard
Contractual Clauses (SCCs) and the recipient's adequacy status.

## 7. Security

WaitLayer applies encryption in transit (TLS), TOTP secrets are encrypted at
rest, and access is guarded by role-based authorization and audit logging.

## 8. Retention

Data is retained per category according to the operator-tunable
`DataRetentionConfig` (e.g. webhook events 90 days, audit logs 365 days).
Anonymized account records are retained only as required for legal/audit
purposes.

## 9. Contact

Data Protection Officer / privacy requests: **privacy@waitlayer.dev**

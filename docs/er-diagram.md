# Entity-Relationship Diagram

Mermaid ER diagram of the core WaitLayer schema. Mirrors `docs/03-database-schema.md`
(prose column definitions) — this is the visual complement.

```mermaid
erDiagram
    users ||--o{ admin_users : "has"
    users ||--o{ sessions : "owns"
    users ||--o{ devices : "owns"
    users ||--o{ user_settings : "has"
    users ||--o{ payout_accounts : "has"
    users ||--o{ advertisers : "owns"
    users ||--o{ wait_state_events : "generates"
    users ||--o{ ad_impressions : "views"
    users ||--o{ earnings_ledger : "earns"
    users ||--o{ payout_requests : "requests"
    users ||--o{ trust_scores : "has"
    users ||--o{ fraud_flags : "flagged_on"
    users ||--o{ api_keys : "owns"
    users ||--o{ referrals : "referrer"
    users ||--o{ referrals : "referee"
    users ||--o{ audit_logs : "actor"

    admin_users ||--o{ campaign_approvals : "reviews"
    admin_users ||--o{ fraud_flags : "reviewed_by"

    advertisers ||--o{ campaigns : "runs"
    campaigns ||--o{ ad_creatives : "contains"
    campaigns ||--o{ categories : "tagged"
    campaigns ||--o{ blocked_categories : "blocks"
    campaigns ||--o{ country_targeting : "targets"
    campaigns ||--o{ campaign_approvals : "needs"
    campaigns ||--o{ ad_impressions : "serves"
    campaigns ||--o{ advertiser_ledger : "debited"

    ad_creatives ||--o{ ad_impressions : "rendered_as"
    sessions ||--o{ wait_state_events : "contains"
    devices ||--o{ wait_state_events : "on"
    devices ||--o{ ad_impressions : "on"

    ad_impressions ||--o{ ad_clicks : "produces"
    ad_impressions ||--o{ ad_reports : "reported_in"
    ad_impressions ||--o{ earnings_ledger : "credits"
    ad_clicks ||--o{ earnings_ledger : "credits"

    earnings_ledger }o--o| payout_requests : "settles_to"
    payout_accounts ||--o{ payout_requests : "funds_to"
    payout_requests ||--o| payout_transactions : "executes"
    payout_requests ||--o{ recovery_debt_cases : "may_owe"

    campaigns ||--o{ earnings_ledger : "funds"
    advertisers ||--o{ advertiser_ledger : "tracks"

    referrals ||--o{ referral_rewards : "pays"
    users ||--o{ referral_rewards : "receives"

    webhook_events }o..o{ payout_transactions : "notifies"
```

## Notes

- Money columns use integer **minor units** + a currency code; ledger tables are
  append-only.
- All mutable business records carry `created_at` / `updated_at`; admin-sensitive
  tables carry `audit_logs` coverage.
- `sessions.device_id` and `wait_state_events.device_id` link activity to a
  registered device for fraud/rate-limit tracking.
- `payout_requests.payout_transaction_id` is nullable until a `payout_transactions`
  row is created (async PSP processing).

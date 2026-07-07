# Database Schema

## Conventions

- Primary keys use UUID.
- Money uses integer minor units and currency code.
- Ledger tables are append-only.
- Sensitive external identifiers are encrypted or hashed where possible.
- All mutable business records include created_at and updated_at.
- Admin-sensitive tables include audit-log coverage.

## Core enums

```sql
user_role: developer, advertiser, admin, support, super_admin
user_status: active, restricted, banned, deleted
trust_level: new, low_trust, normal, high_trust, restricted, banned
campaign_status: draft, submitted, approved, active, paused, rejected, archived
creative_status: draft, pending_review, approved, rejected, paused
bid_type: cpm, cpc
event_type: wait_state_start, wait_state_end, ad_request, ad_rendered, qualified_impression, click, report_ad
ledger_entry_type: debit, credit, hold, release, reversal, payout, refund, reserve, fee
ledger_status: estimated, pending, confirmed, held, reversed, paid, void
payout_provider: manual, paypal_email, paypal_payouts, stripe_connect, payoneer, wise, razorpay
payout_status: draft, requested, under_review, approved, rejected, processing, paid, failed, cancelled
fraud_flag_status: open, reviewing, resolved_valid, resolved_invalid, escalated
approval_decision: approved, rejected, changes_requested
```

## Identity and access

### users

- id uuid primary key
- email citext unique not null
- email_verified_at timestamptz
- password_hash text nullable
- display_name text
- role user_role not null default developer
- status user_status not null default active
- country_code char(2)
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz

### admin_users

- id uuid primary key
- user_id uuid references users(id)
- admin_role user_role not null
- permissions jsonb not null default '{}'
- created_by uuid references users(id)
- created_at timestamptz not null

### sessions

- id uuid primary key
- user_id uuid references users(id)
- device_id uuid references devices(id)
- token_hash text not null
- ip_hash text
- user_agent_hash text
- expires_at timestamptz not null
- revoked_at timestamptz
- created_at timestamptz not null

### devices

- id uuid primary key
- user_id uuid references users(id)
- device_fingerprint_hash text not null
- public_key text
- tool_type text not null
- extension_version text
- cli_version text
- platform text
- status text not null default 'active'
- first_seen_at timestamptz not null
- last_seen_at timestamptz
- unique(user_id, device_fingerprint_hash)

## Developer settings and payout account

### user_settings

- user_id uuid primary key references users(id)
- ads_enabled boolean not null default true
- quiet_mode boolean not null default false
- max_ads_per_hour int not null default 12
- allowed_categories text[] not null default '{}'
- blocked_categories text[] not null default '{}'
- privacy_export_requested_at timestamptz
- deletion_requested_at timestamptz
- created_at timestamptz not null
- updated_at timestamptz not null

### payout_accounts

- id uuid primary key
- user_id uuid references users(id)
- provider payout_provider not null
- destination_email citext
- destination_external_id text
- country_code char(2)
- currency char(3) not null default 'USD'
- status text not null default 'pending_validation'
- verified_at timestamptz
- metadata jsonb not null default '{}'
- created_at timestamptz not null
- updated_at timestamptz not null

Constraint:

- one active payout account per user/provider via a partial unique index on `(user_id, provider)` where `is_active = true`.
- inactive historical payout destinations are retained for audit and are not globally unique.
- same PayPal email across many accounts triggers fraud review; do not hard-block without human review in MVP.

## Advertisers and campaigns

### advertisers

- id uuid primary key
- owner_user_id uuid references users(id)
- company_name text not null
- website_url text not null
- billing_email citext not null
- status text not null default 'pending_review'
- stripe_customer_id text
- trust_status text not null default 'new'
- created_at timestamptz not null
- updated_at timestamptz not null

### campaigns

- id uuid primary key
- advertiser_id uuid references advertisers(id)
- name text not null
- status campaign_status not null default draft
- category_id uuid references categories(id)
- bid_type bid_type not null default cpm
- bid_amount_minor int not null
- budget_total_minor int not null
- budget_spent_minor int not null default 0
- currency char(3) not null default 'USD'
- starts_at timestamptz
- ends_at timestamptz
- frequency_cap_user_hour int default 2
- frequency_cap_user_day int default 8
- quality_score numeric(5,2) not null default 50
- submitted_at timestamptz
- approved_at timestamptz
- rejected_at timestamptz
- created_at timestamptz not null
- updated_at timestamptz not null

### ad_creatives

- id uuid primary key
- campaign_id uuid references campaigns(id)
- title text not null
- sponsored_message text not null
- destination_url text not null
- display_domain text not null
- status creative_status not null default draft
- rejected_reason text
- created_at timestamptz not null
- updated_at timestamptz not null

### categories

- id uuid primary key
- slug text unique not null
- name text not null
- is_blocked boolean not null default false
- is_mvp_allowed boolean not null default true
- created_at timestamptz not null

### blocked_categories

- id uuid primary key
- category_id uuid nullable references categories(id) on delete set null
- reason text not null
- blocked_by text not null
- created_at timestamptz not null

### country_targeting

- id uuid primary key
- campaign_id uuid references campaigns(id)
- country_code char(2) not null
- include boolean not null default true

### tool_integrations

- id uuid primary key
- slug text unique not null
- name text not null
- type text not null
- status text not null default 'enabled'
- min_supported_version text
- created_at timestamptz not null

## Event tables

### wait_state_events

- id uuid primary key
- user_id uuid references users(id)
- device_id uuid references devices(id)
- session_id uuid references sessions(id)
- tool_integration_id uuid references tool_integrations(id)
- event_type event_type not null
- wait_state_id uuid not null
- occurred_at timestamptz not null
- duration_ms int
- country_code char(2)
- ip_hash text
- event_signature text not null
- idempotency_key text unique not null
- created_at timestamptz not null

### ad_impressions

- id uuid primary key
- campaign_id uuid references campaigns(id)
- creative_id uuid references ad_creatives(id)
- user_id uuid references users(id)
- device_id uuid references devices(id)
- session_id uuid references sessions(id)
- wait_state_id uuid not null
- impression_token_hash text unique not null
- rendered_at timestamptz
- qualified_at timestamptz
- visible_duration_ms int
- billable boolean not null default false
- invalidated_at timestamptz
- invalid_reason text
- country_code char(2)
- ip_hash text
- created_at timestamptz not null

Indexes:

- (campaign_id, qualified_at)
- (user_id, qualified_at)
- (device_id, qualified_at)
- (ip_hash, qualified_at)

### ad_clicks

- id uuid primary key
- impression_id uuid references ad_impressions(id)
- campaign_id uuid references campaigns(id)
- creative_id uuid references ad_creatives(id)
- user_id uuid references users(id)
- device_id uuid references devices(id)
- session_id uuid references sessions(id)
- clicked_at timestamptz not null
- target_url text not null
- ip_hash text
- valid boolean not null default false
- invalidated_at timestamptz
- invalid_reason text
- idempotency_key text unique not null
- created_at timestamptz not null

### ad_reports

- id uuid primary key
- impression_id uuid references ad_impressions(id)
- user_id uuid references users(id)
- reason text not null
- details text
- status text not null default 'open'
- created_at timestamptz not null
- resolved_at timestamptz

## Ledger

### earnings_ledger

- id uuid primary key
- user_id uuid references users(id)
- impression_id uuid references ad_impressions(id)
- click_id uuid references ad_clicks(id)
- payout_request_id uuid references payout_requests(id)
- entry_type ledger_entry_type not null
- status ledger_status not null
- amount_minor int not null
- currency char(3) not null
- description text not null
- available_at timestamptz
- idempotency_key text unique not null
- created_at timestamptz not null

### advertiser_ledger

- id uuid primary key
- advertiser_id uuid references advertisers(id)
- campaign_id uuid references campaigns(id)
- impression_id uuid references ad_impressions(id)
- click_id uuid references ad_clicks(id)
- entry_type ledger_entry_type not null
- amount_minor int not null
- currency char(3) not null
- description text not null
- stripe_payment_intent_id text
- idempotency_key text unique not null
- created_at timestamptz not null

### platform_ledger

- id uuid primary key
- campaign_id uuid references campaigns(id)
- impression_id uuid references ad_impressions(id)
- entry_type ledger_entry_type not null
- amount_minor int not null
- currency char(3) not null
- bucket text not null -- platform_fee, fraud_reserve, payment_reserve
- idempotency_key text unique not null
- created_at timestamptz not null

## Payouts

### payout_requests

- id uuid primary key
- user_id uuid references users(id)
- payout_account_id uuid references payout_accounts(id)
- status payout_status not null default requested
- requested_amount_minor int not null
- approved_amount_minor int
- currency char(3) not null
- requested_at timestamptz not null
- reviewed_by uuid references users(id)
- reviewed_at timestamptz
- rejection_reason text
- created_at timestamptz not null
- updated_at timestamptz not null

### payout_transactions

- id uuid primary key
- payout_request_id uuid references payout_requests(id)
- provider payout_provider not null
- provider_transaction_id text
- status payout_status not null
- amount_minor int not null
- currency char(3) not null
- paid_at timestamptz
- failure_reason text
- metadata jsonb not null default '{}'
- created_by uuid references users(id)
- created_at timestamptz not null
- updated_at timestamptz not null

### recovery_debt_cases

- id uuid primary key
- user_id uuid references users(id) on delete restrict
- status recovery_debt_case_status not null default open
- amount_minor int not null
- currency char(3) not null default 'USD'
- external_reference text
- note text
- opened_by_user_id uuid references users(id) on delete set null
- resolved_by_user_id uuid references users(id) on delete set null
- resolved_at timestamptz
- created_at timestamptz not null
- updated_at timestamptz not null

Indexes and constraints:

- index on (user_id, currency)
- index on (status, updated_at)
- partial unique index on (user_id, currency) where status in ('open', 'in_collections')

## Fraud and trust

### fraud_flags

- id uuid primary key
- user_id uuid references users(id)
- device_id uuid references devices(id)
- campaign_id uuid references campaigns(id)
- impression_id uuid references ad_impressions(id)
- click_id uuid references ad_clicks(id)
- flag_type text not null
- severity text not null
- score_delta int not null default 0
- status fraud_flag_status not null default open
- evidence jsonb not null default '{}'
- reviewed_by uuid references users(id)
- resolved_at timestamptz
- created_at timestamptz not null

### trust_scores

- user_id uuid primary key references users(id)
- score int not null default 40
- level trust_level not null default new
- account_age_points int not null default 0
- email_verified_points int not null default 0
- github_verified_points int not null default 0
- device_consistency_points int not null default 0
- activity_pattern_points int not null default 0
- payout_history_points int not null default 0
- fraud_penalty_points int not null default 0
- updated_at timestamptz not null

## Approvals, webhooks, and audit

### campaign_approvals

- id uuid primary key
- campaign_id uuid references campaigns(id)
- creative_id uuid references ad_creatives(id)
- reviewer_id uuid references users(id)
- decision approval_decision not null
- reason text
- checklist jsonb not null default '{}'
- created_at timestamptz not null

### api_keys

- id uuid primary key
- owner_user_id uuid references users(id)
- advertiser_id uuid references advertisers(id)
- key_hash text unique not null
- scopes text[] not null
- last_used_at timestamptz
- revoked_at timestamptz
- created_at timestamptz not null

### webhook_events

- id uuid primary key
- provider text not null
- event_id text not null
- event_type text not null
- payload jsonb not null
- processed_at timestamptz
- error text
- created_at timestamptz not null
- unique(provider, event_id)

### audit_logs

- id uuid primary key
- actor_user_id uuid references users(id)
- target_type text not null
- target_id uuid
- action text not null
- before jsonb
- after jsonb
- ip_hash text
- created_at timestamptz not null

## Referrals

### referrals

- id uuid primary key
- referrer_user_id uuid references users(id)
- referred_user_id uuid references users(id)
- code text not null
- status text not null default 'pending'
- created_at timestamptz not null

### referral_rewards

- id uuid primary key
- referral_id uuid references referrals(id)
- user_id uuid references users(id)
- amount_minor int not null
- currency char(3) not null
- status ledger_status not null default pending
- created_at timestamptz not null

## Required tests

- Qualified impression creates balanced ledger entries exactly once.
- Duplicate impression token cannot double-bill.
- Campaign budget cannot go negative under concurrent requests.
- Invalidated impression reverses user earnings and credits advertiser.
- Confirmed earnings exclude held and reversed entries.
- Payout request only includes available confirmed earnings.
- Manual payout marking moves included entries to paid.
- Same PayPal email across multiple accounts creates fraud flag.

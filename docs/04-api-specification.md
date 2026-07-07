# API Specification

## API standards

- Base path: `/api/v1`.
- Request and response bodies are JSON.
- All write endpoints use validation schemas.
- Extension and CLI endpoints reject unknown fields.
- Auth web routes use secure session cookies or bearer tokens.
- Extension routes use device token plus signed payload.
- Idempotency keys are required for event, ledger-impacting, billing, and payout endpoints.
- Every response includes `request_id`.

## Auth

### POST /auth/signup

Roles: public

Request:

```json
{
  "email": "dev@example.com",
  "password": "minimum-12-chars",
  "role": "developer"
}
```

Response: user profile and session.

### POST /auth/login

Roles: public

Request: email and password.

Response: session.

### POST /auth/logout

Roles: authenticated

Response: revoked session.

### GET /auth/me

Roles: authenticated

Response: current user, role, status, settings summary.

## Developer

### GET /developer/dashboard

Response:

- today_estimated_earnings
- confirmed_earnings
- pending_earnings
- held_earnings
- available_for_payout
- lifetime_earnings
- trust_level
- payout_hold_status
- recent_activity

### GET /developer/earnings

Query: date range, status.

Response: ledger entries and aggregates.

### GET /developer/payouts

Response: payout account, threshold, available balance, payout requests, payout transactions.

### POST /developer/payout-method

Request:

```json
{
  "provider": "paypal_email",
  "destination_email": "user@example.com",
  "currency": "USD"
}
```

Response: payout account status.

### POST /developer/request-payout

Request:

```json
{
  "payout_account_id": "uuid",
  "amount_minor": 1000,
  "currency": "USD",
  "idempotency_key": "uuid"
}
```

Rules:

- Amount must meet threshold.
- User must not be restricted or banned.
- Available confirmed earnings must cover amount.
- Payout hold must be expired unless admin override applies.

### GET /developer/settings

Response: ad preferences, privacy settings, connected accounts.

### PATCH /developer/settings

Request: ads_enabled, quiet_mode, max_ads_per_hour, allowed_categories, blocked_categories.

### POST /developer/export-data

Response: export job id.

### POST /developer/delete-account

Response: deletion request status.

## Extension and CLI

### POST /extension/register-device

Request:

```json
{
  "tool_type": "vscode",
  "extension_version": "0.1.0",
  "platform": "linux-x64",
  "device_fingerprint": "opaque-client-generated-fingerprint",
  "public_key": "pem-or-jwk"
}
```

Response: device_id, device_token, signing requirements.

### POST /extension/wait-state/start

Request:

```json
{
  "device_id": "uuid",
  "session_id": "uuid",
  "wait_state_id": "uuid",
  "tool_type": "vscode",
  "occurred_at": "2026-06-30T12:00:00.000Z",
  "idempotency_key": "uuid",
  "signature": "base64"
}
```

Response: accepted.

### POST /extension/wait-state/end

Request: wait_state_id, duration_ms, idempotency_key, signature.

Response: accepted.

### POST /extension/ad-request

Request:

```json
{
  "device_id": "uuid",
  "session_id": "uuid",
  "wait_state_id": "uuid",
  "tool_type": "vscode",
  "extension_version": "0.1.0",
  "allowed_categories": ["developer-tools"],
  "blocked_categories": ["crypto"],
  "idempotency_key": "uuid",
  "signature": "base64"
}
```

Response:

```json
{
  "ad": {
    "campaign_id": "uuid",
    "creative_id": "uuid",
    "label": "Sponsored",
    "message": "Railway - Deploy your AI app in seconds",
    "display_domain": "railway.app",
    "click_url": "https://waitlayer.example/click/token",
    "impression_token": "opaque-token",
    "minimum_visible_ms": 5000
  }
}
```

No-ad response:

```json
{
  "ad": null,
  "reason": "no_eligible_campaign"
}
```

### POST /extension/ad-rendered

Request: impression_token, rendered_at, visible_surface, idempotency_key, signature.

Response: accepted.

### POST /extension/impression-qualified

Request: impression_token, qualified_at, visible_duration_ms, idempotency_key, signature.

Rules:

- visible_duration_ms must meet minimum.
- rendered event must exist.
- impression token must match same user/session/device.
- campaign budget must still be reserved or available.
- duplicate token does not double-bill.

### POST /extension/click

Request: impression_token, clicked_at, idempotency_key, signature.

Response: redirect URL token or accepted event depending on client flow.

### POST /extension/report-ad

Request: impression_token, reason, optional details.

Response: report id.

## Advertiser

### POST /advertiser/profile

Request: company_name, website_url, billing_email.

Response: advertiser profile.

### GET /advertiser/dashboard

Response: spend, impressions, clicks, CTR, active campaigns, budget remaining, invalid traffic.

### POST /advertiser/campaigns

Request:

```json
{
  "name": "Launch campaign",
  "category_id": "uuid",
  "sponsored_message": "Supabase - Build faster with Postgres",
  "destination_url": "https://supabase.com",
  "bid_type": "cpm",
  "bid_amount_minor": 500,
  "budget_total_minor": 50000,
  "currency": "USD",
  "targeting": {
    "countries": ["US", "IN", "GB"],
    "tools": ["vscode", "cli"],
    "developer_categories": ["backend", "ai"],
    "stack_interests": ["postgres", "typescript"]
  },
  "frequency_caps": {
    "user_hour": 2,
    "user_day": 8
  }
}
```

Response: draft campaign.

### PATCH /advertiser/campaigns/:id

Rules: only draft, rejected, paused, or archived campaigns can be edited according to status policy.

### POST /advertiser/campaigns/:id/submit

Response: submitted for approval.

### POST /advertiser/campaigns/:id/pause

Response: paused.

### POST /advertiser/campaigns/:id/resume

Rules: campaign must be approved and funded.

### GET /advertiser/reports

Query: campaign_id, date range, grouping.

Response: impressions, clicks, CTR, spend, invalid traffic, remaining budget, country/tool breakdown.

### GET /advertiser/billing

Response: advertiser-ledger primary balance, per-currency balances, total confirmed deposits/charges, and recent advertiser ledger entries.

### POST /advertiser/deposit-session

Request: amountMinor, currency optional.

Response: Stripe checkout session id and redirect URL.

## Admin

### GET /admin/overview

Response: DAU, active campaigns, spend, earnings, payout queue, fraud queue, invalid traffic, system health.

### GET /admin/users

Query: status, trust_level, country, search.

Response: user list.

### GET /admin/advertisers

Response: advertiser list and review status.

### GET /admin/campaigns/pending

Response: campaigns and creatives awaiting review.

### POST /admin/campaigns/:id/approve

Request: checklist and note.

Response: approved campaign.

### POST /admin/campaigns/:id/reject

Request: reason and policy reference.

Response: rejected campaign.

### POST /admin/campaigns/:id/pause

Request: reason.

Response: paused campaign.

### GET /admin/fraud

Query: status, severity, user_id, campaign_id.

Response: fraud flags and evidence summary.

### POST /admin/fraud/:id/resolve

Request: decision, notes, actions.

Actions may include hold earnings, release earnings, restrict user, ban user, credit advertiser, invalidate events.

### GET /admin/payouts/pending

Response: payout requests with user, trust score, available earnings, hold status, fraud flags.

### POST /admin/payouts/:id/approve

Response: approved payout request.

### POST /admin/payouts/:id/reject

Request: reason.

Response: rejected payout request and released eligible earnings.

### POST /admin/payouts/:id/mark-paid

Request:

```json
{
  "provider": "manual",
  "provider_transaction_id": "PAYPAL-MANUAL-ID",
  "paid_at": "2026-06-30T12:00:00.000Z",
  "amount_minor": 1000,
  "currency": "USD",
  "note": "Paid via PayPal manually"
}
```

Response: payout transaction and paid ledger entries.

### GET /admin/audit-log

Query: actor_user_id, target_type, action, date range.

Response: audit log entries.

## Public pages API

- POST /waitlist/developer
- POST /waitlist/advertiser
- POST /contact
- GET /public/campaign-categories

## Error codes

- `VALIDATION_FAILED`
- `AUTH_REQUIRED`
- `FORBIDDEN`
- `DEVICE_BLOCKED`
- `ADS_DISABLED`
- `NO_ELIGIBLE_CAMPAIGN`
- `RATE_LIMITED`
- `DUPLICATE_EVENT`
- `BUDGET_EXHAUSTED`
- `IMPRESSION_NOT_RENDERED`
- `MINIMUM_DURATION_NOT_MET`
- `FRAUD_HOLD`
- `PAYOUT_THRESHOLD_NOT_MET`
- `INSUFFICIENT_AVAILABLE_EARNINGS`
- `CAMPAIGN_REVIEW_REQUIRED`

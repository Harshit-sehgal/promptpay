# Dodo Payments product-review access

This runbook creates a normal advertiser account that Dodo Payments (or another
external compliance reviewer) can use to inspect the authenticated WaitLayer
product. It does **not** create an admin, bypass authentication, enable deposits,
or grant access to provider secrets.

## What the bootstrap creates

`pnpm bootstrap:review-advertiser` creates:

- one active, email-verified `advertiser` user with a bcrypt-hashed password;
- the matching advertiser profile;
- one **draft** CPM campaign;
- one **draft** sample creative;
- an audit-log record identifying that the account was created by the external-review bootstrap.

The draft campaign is intentionally inert. It is present only so the advertiser
dashboard is useful during review and does not serve by itself.

## Prerequisites

Do not send review credentials until all of the following are true:

1. The production/staging database has the current migrations applied.
2. The NestJS API is deployed and reachable at its stable HTTPS origin.
3. The Vercel web/BFF deployment points to that API (`NEXT_PUBLIC_API_URL` and
   `API_INTERNAL_URL`) and its auth-key configuration matches the API.
4. `/api/auth/config` is healthy from the deployed web origin and password login
   reaches the API.
5. The reviewer can reach `/auth/login` and `/advertiser` from the public web origin.
6. Real-money feature switches remain fail-closed unless separately approved.

A marketing-only deployment with a working "Join beta" form is not sufficient
for product review. The authenticated web + API path must be deployed.

## Create the review account

From a trusted operator machine with access to the target database:

```sh
DATABASE_URL='<target database url>' \
  pnpm bootstrap:review-advertiser -- \
    --email '<dedicated review mailbox>' \
    --name 'Dodo Payments Reviewer' \
    --company 'Dodo Payments Review' \
    --country 'US' \
    --website 'https://www.waitlayer.com'
```

The command prompts for the password with hidden input. Prefer the prompt rather
than `--password` so the credential does not end up in shell history or the
process list.

The command refuses to overwrite an existing email. Use a dedicated review
mailbox rather than repurposing a real advertiser account.

## Validate before sharing

Use a private/incognito browser session and confirm:

1. Sign in at `https://www.waitlayer.com/auth/login`.
2. The account lands on the advertiser area.
3. The draft review campaign is visible.
4. Campaign/payment actions behave according to the current beta switches; no
   hidden mock-auth or admin-only access is exposed.
5. Sign out and sign back in once more with the exact credentials being shared.

## What to send Dodo

Send only:

- Login URL: `https://www.waitlayer.com/auth/login`
- Review email/username
- Review password
- A one-line note that the account is a dedicated advertiser review account and
  the sample campaign is draft-only.

Never send `DATABASE_URL`, Dodo API/webhook credentials, JWT keys, admin
credentials, or infrastructure access.

## Scope boundary

This access bootstrap solves only the **review-account** problem. It does not
change WaitLayer's payout economics, payout-provider architecture, Dodo product
configuration, or production infrastructure. Those must be reviewed and
deployed independently before any live money switch is enabled.

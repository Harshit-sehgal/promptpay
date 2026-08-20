# Dodo Payments product-review access

This runbook creates and verifies a normal advertiser account that Dodo Payments
(or another external compliance reviewer) can use to inspect the authenticated
Ateva product. It does **not** create an admin, bypass authentication, enable
money switches, or grant access to provider secrets.

## Product/payment state shown to the reviewer

The review deployment must match the beta architecture:

```text
Advertiser → Dodo Payments → Ateva

Ateva → separate payout provider → eligible participant   (future, disabled in beta)
```

Dodo is used only for the advertiser/customer transaction. Ateva does not
ask Dodo to split that transaction or forward part of it to participants. The
initial participant reward design is fiat-only and remains disabled until a
separate payout provider and independent wait attestation are approved.

## What the bootstrap creates

`pnpm bootstrap:review-advertiser` creates:

- one active, email-verified `advertiser` user with a bcrypt-hashed password;
- the matching advertiser profile;
- one **draft** CPM campaign;
- one **draft** sample creative;
- an audit-log record identifying the external-review bootstrap.

The draft campaign is intentionally inert and cannot serve by itself.

## Prerequisites

Do not send review credentials until all of the following are true:

1. The target database has current production migrations applied.
2. The NestJS API is deployed at a stable HTTPS origin with production Postgres
   and Redis available.
3. The deployed web/BFF points to that API and its auth key configuration matches.
4. The public web origin reaches `/api/auth/config` and `/api/auth/login`.
5. `/auth/login` and `/advertiser` are reachable from outside the operator network.
6. The public payment/reward wording passes `scripts/public-payment-claims.test.mjs`.
7. Real-money switches remain fail-closed unless separately approved.

Use the existing staging/production release workflow and deployment checklist for
the deployment itself. A marketing-only site with a working “Join beta” button
is not sufficient for product review.

## Protected GitHub environment secrets

The manual `.github/workflows/dodo-review-access.yml` workflow expects these
secrets in the protected `production` environment:

| Secret                    | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `PRODUCTION_DATABASE_URL` | Target database used only by the account bootstrap |
| `PRODUCTION_WEB_URL`      | Public HTTPS web origin used by the smoke test     |
| `DODO_REVIEW_EMAIL`       | Dedicated advertiser review mailbox                |
| `DODO_REVIEW_PASSWORD`    | Strong review-account password                     |

Use a dedicated mailbox. Do not reuse an operator/admin account.

## Preferred flow — GitHub Actions

After the application has been deployed:

1. Open **Actions → Dodo Review Access → Run workflow**.
2. Set `bootstrap_account=true` on the first run only.
3. Approve the protected `production` environment if required.
4. Confirm the workflow passes all four checks:
   - auth configuration reachable;
   - advertiser login succeeds;
   - draft review campaign visible;
   - authenticated advertiser dashboard reachable.
5. On later checks, run with `bootstrap_account=false`; this verifies the same
   credentials without mutating the account.

The workflow never prints the password, cookies, database URL, JWTs, or provider
credentials and does not toggle any money switch.

## Manual fallback

From a trusted operator machine with access to the target database:

```sh
DATABASE_URL='<target database url>' \
  pnpm bootstrap:review-advertiser \
    --email '<dedicated review mailbox>' \
    --name 'Dodo Payments Reviewer' \
    --company 'Dodo Payments Review' \
    --country 'US' \
    --website 'https://www.ateva.com'
```

The command prompts for the password with hidden input. For non-interactive
protected automation it can instead read `REVIEW_ACCOUNT_PASSWORD`.

Then validate the deployed journey without printing secrets:

```sh
REVIEW_BASE_URL='https://www.ateva.com' \
REVIEW_EMAIL='<dedicated review mailbox>' \
REVIEW_ACCOUNT_PASSWORD='<password>' \
pnpm review:smoke
```

## What to send Dodo

Send only:

- Login URL: `https://www.ateva.com/auth/login` (or the actual public review origin)
- Review email/username
- Review password
- A short note that this is a dedicated advertiser review account and the sample
  campaign is draft-only.

Never send `DATABASE_URL`, Dodo API/webhook credentials, JWT keys, admin
credentials, server access, or deployment credentials.

## Scope boundary

Reviewer access does not itself approve live deposits or participant payouts.
Dodo production credentials/product/webhook verification, production
infrastructure, and any future payout provider remain separate launch gates.

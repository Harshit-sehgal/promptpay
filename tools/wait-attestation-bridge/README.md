# Wait-attestation Bridge (reference/stub)

This is a **reference implementation** of an independent wait-attestation
provider bridge. It is intentionally small, self-contained, and safe for local
and staging use. **Do not use it as-is in production:** a real bridge must run
independently of WaitLayer clients, protect its signing key in an HSM/secret
manager, measure waits with its own telemetry, and undergo a security review.

## What it does

1. Owns an RSA-256 signing key that is **not** available to WaitLayer clients.
2. Exposes a single `POST /attest` endpoint.
3. Verifies a bearer token, validates the request shape, and signs a JWT
   assertion that the WaitLayer API can verify against
   `WAIT_ATTESTATION_ISSUERS` and `VERIFIED_WAIT_ATTESTATION_VERSIONS`.

> **Stub limitation:** this reference implementation always signs a fixed
> 5-second duration. A real bridge must independently measure the wait and
> reject requests that exceed its own policy (e.g. max duration, idle time).

## Quick start

```bash
cp .env.example .env
# edit .env — at minimum set BRIDGE_TOKEN
pnpm install
pnpm dev
```

The first boot generates a key pair under `.keys/` unless you point it at
existing PEM files.

## API contract

`POST /attest`

Headers:

```text
Authorization: Bearer <BRIDGE_TOKEN>
Content-Type: application/json
```

Body:

```json
{
  "nonce": "<server-issued nonce>",
  "attestationSessionId": "<WaitLayer attestation session id>",
  "userId": "<WaitLayer user id>",
  "deviceId": "<registered device id>",
  "sessionId": "<client session id>",
  "waitStateId": "<wait state id>",
  "provider": "<optional; must match ATTESTATION_PROVIDER>"
}
```

Response:

```json
{ "assertion": "<RS256 JWT>" }
```

### Assertion claims (signed JWT)

| Claim                 | Source        | Notes                                        |
| --------------------- | ------------- | -------------------------------------------- |
| `sub`                 | `userId`      | WaitLayer user id                            |
| `device_id`           | `deviceId`    | Registered device id                         |
| `nonce`               | `nonce`       | Server-issued single-use nonce               |
| `session_id`          | `sessionId`   | Client session id                            |
| `wait_state_id`       | `waitStateId` | Wait state id                                |
| `provider`            | bridge config | Matches `ATTESTATION_PROVIDER`               |
| `event_id`            | generated     | Random UUID                                  |
| `attestation_version` | bridge config | Matches `VERIFIED_WAIT_ATTESTATION_VERSIONS` |
| `started_at_ms`       | now           | Operation start time                         |
| `ended_at_ms`         | now + 5000    | **Stub only:** always 5 seconds later        |
| `duration_ms`         | 5000          | **Stub only:** fixed duration                |
| `iat`                 | now           | JWT issued-at                                |
| `iss`                 | `ISSUER`      | Must match `WAIT_ATTESTATION_ISSUERS` entry  |
| `aud`                 | `AUDIENCE`    | Must match `WAIT_ATTESTATION_ISSUERS` entry  |
| `exp`                 | now + 300s    | JWT expiry                                   |
| `nbf`                 | now - 1s      | JWT not-before                               |

> **Stub limitation:** this reference bridge does not measure real waits. The
> fixed 5-second duration exists only so local/staging smoke tests can exercise
> the consume path. A production bridge must derive `started_at_ms`,
> `ended_at_ms`, and `duration_ms` from independent observation and reject
> requests that violate its policy (max duration, idle time, etc.).

## Configuring the WaitLayer API to trust this bridge

Set `WAIT_ATTESTATION_ISSUERS` in the API environment to the bridge's public
key and issuer/audience:

```json
[
  {
    "provider": "waitlayer-stub-bridge",
    "issuer": "https://waitlayer.local/attestation",
    "audience": "waitlayer-client",
    "publicKeys": {
      "<kid printed on startup or from .keys/bridge-public.pem>": "-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----"
    }
  }
]
```

Also set:

```text
VERIFIED_WAIT_ATTESTATION_VERSIONS=stub-v1
```

## Configuring the CLI / VS Code extension

```text
WAITLAYER_ATTESTATION_PROVIDER=waitlayer-stub-bridge
WAITLAYER_ATTESTATION_PROVIDER_URL=http://localhost:4003/attest
```

VS Code settings:

```json
{
  "waitlayer.attestationProvider": "waitlayer-stub-bridge",
  "waitlayer.attestationProviderUrl": "http://localhost:4003/attest"
}
```

## Production notes

- Rotate keys regularly and support multiple `publicKeys` entries (`kid` map).
- Run the bridge on its own network, behind an HTTPS-terminating proxy, and
  require mTLS or a secret-manager-distributed bearer token.
- Measure the actual wait duration independently; do not trust client-supplied
  timestamps for `started_at_ms`/`ended_at_ms`/`duration_ms`.
- Store no more telemetry than required; never log nonces or raw provider
  payloads.

import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

import {
  DETECTOR_VERSION,
  type DetectorEvidence,
  parseMinor,
  signEvidence,
  signPayload,
} from '@waitlayer/shared';

import { ConfigurationManager } from './config';
import { requestHostnameForUrl, resolveCredentialSafeUrl } from './transport-policy';
import type { WaitSignal } from './wait-detector';

export interface Ad {
  impressionToken: string;
  campaignId: string;
  creativeId: string;
  title: string;
  message: string;
  label: string;
  displayDomain: string;
  destinationUrl: string;
  ctaText?: string | null;
}

/**
 * Best-effort ISO-3166-1 alpha-2 country code from the host locale (A-056).
 * Returns undefined when unavailable; the server falls back to profile country.
 */
function detectCountryCode(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? env.LANGUAGE;
  if (!raw) return undefined;
  const match = raw.split(/[.\s]/)[0]?.split('_')[1];
  if (match && /^[A-Za-z]{2}$/.test(match)) return match.toUpperCase();
  return undefined;
}

interface AmountEntry {
  // Money is kept as an exact bigint; the API serializes BigInt columns as
  // decimal strings and parseMinor converts them back to bigint without the
  // precision loss that `Number()` introduces above 2^53.
  amountMinor: bigint;
  currency: string;
  /**
   * Per-currency minor-unit totals, serialized as decimal strings (matching
   * exactly how the API sends BigInt columns). Present only when the account
   * holds a mixed-currency balance. The scalar `amountMinor`/`currency` above
   * remain the legacy single-currency fallback for any client that does not
   * yet consume `byCurrency`.
   */
  byCurrency?: Record<string, string>;
}

/** Backend returns { available, pending, total, paidOut } each as { amountMinor, currency }. */
export interface Balance {
  available: AmountEntry;
  pending: AmountEntry;
  total: AmountEntry;
  paidOut: AmountEntry;
}

/** Raw API shape where monetary BigInt columns are serialized as strings. */
interface RawAmountEntry {
  amountMinor: number | string;
  currency: string;
  byCurrency?: Record<string, number | string>;
}

interface RawBalance {
  available: RawAmountEntry;
  pending: RawAmountEntry;
  total: RawAmountEntry;
  paidOut: RawAmountEntry;
}

export type WaitLaunchMode = 'paused' | 'ads_only' | 'earnings_enabled';

export interface ServerAdResponse {
  ad: Ad | null;
  mode?: WaitLaunchMode;
  reason?: string;
}

interface RegisterDeviceResponse {
  id: string;
  userId: string;
  eventSecret?: string;
}

export class ApiClient {
  private currentTokens: { accessToken?: string; refreshToken?: string } | null = null;
  private _refreshInProgress: Promise<{ accessToken: string; refreshToken: string } | null> | null =
    null;
  private _initialized: Promise<void>;
  private deviceEventSecret: string | null = null;

  constructor(private config: ConfigurationManager) {
    // Load persisted auth and device signing state from SecretStorage on construction.
    this._initialized = Promise.all([
      this.config.getTokens(),
      this.config.getDeviceEventSecret(),
    ]).then(([tokens, eventSecret]) => {
      if (tokens) this.currentTokens = tokens;
      this.deviceEventSecret = eventSecret;
    });
  }

  /** Sign payload object with HMAC using canonical JSON (sorted keys).
   *  Event requests require the per-device secret issued at registration.
   *  The old global signing key fallback is intentionally not used: the API
   *  rejects legacy global-HMAC event signatures. */
  async signEventPayload(payload: Record<string, unknown>): Promise<string> {
    await this._initialized;
    if (!this.deviceEventSecret) {
      throw new Error(
        'WaitLayer device is not registered with an event secret. Re-run device registration.',
      );
    }
    return signPayload(payload, this.deviceEventSecret);
  }

  /** Refresh the access token using the stored refresh token.
   *  Returns the new token pair or null on failure. */
  private async refreshTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (!this.currentTokens?.refreshToken) return null;

    // Deduplicate concurrent refresh attempts
    if (this._refreshInProgress) return this._refreshInProgress;

    this._refreshInProgress = (async () => {
      try {
        const refreshToken = this.currentTokens!.refreshToken!;
        // Backend returns flat { accessToken, refreshToken } — no data wrapper
        const tokens = await this.post<{ accessToken: string; refreshToken: string }>(
          '/auth/refresh',
          { refreshToken },
          true, // skipAuth: don't attach Authorization header for refresh itself
          { skipRetry: true }, // never transient-retry a refresh: stale token → family revoke
        );
        // Persist before exposing the rotated pair to requests. Otherwise a
        // retry can succeed with the new refresh token while SecretStorage
        // still contains the now-revoked token if the host exits immediately.
        await this.config.storeTokens(tokens);
        this.currentTokens = tokens;
        return tokens;
      } catch {
        // Refresh failed — clear tokens
        this.currentTokens = null;
        await this.config.clearTokens();
        return null;
      } finally {
        this._refreshInProgress = null;
      }
    })();

    return this._refreshInProgress;
  }

  private deviceUUID: string | null = null;

  async getOrRegisterDevice(): Promise<string> {
    await this._initialized;
    if (this.deviceUUID && this.deviceEventSecret) return this.deviceUUID;

    try {
      const stored = await this.config.getDeviceUUID();
      const storedSecret = await this.config.getDeviceEventSecret();
      if (stored && storedSecret) {
        this.deviceUUID = stored;
        this.deviceEventSecret = storedSecret;
        return stored;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[WaitLayer] Failed to read stored device UUID/secret: ${msg}`);
    }

    const fingerprint = await this.config.getDeviceFingerprint();
    const registrationPayload = {
      toolType: 'vscode',
      fingerprintHash: fingerprint,
      extensionVersion: '0.0.1',
      platform: process.platform || 'unknown',
      ...(this.deviceEventSecret ? { existingEventSecret: this.deviceEventSecret } : {}),
    };
    let res: RegisterDeviceResponse;
    try {
      res = await this.post<RegisterDeviceResponse>(
        '/extension/register-device',
        registrationPayload,
      );
    } catch (err: unknown) {
      if (!isDeviceRecoveryError(err)) throw err;
      const recoverySupportToken = await vscode.window.showInputBox({
        prompt: 'WaitLayer device recovery token',
        placeHolder: 'Paste the one-time token issued by WaitLayer support',
        password: true,
        ignoreFocusOut: true,
      });
      if (!recoverySupportToken?.trim()) throw err;
      res = await this.post<RegisterDeviceResponse>('/extension/register-device', {
        ...registrationPayload,
        recoverySupportToken: recoverySupportToken.trim(),
      });
    }

    if (res && res.id) {
      if (!res.eventSecret) {
        throw new Error('Device registration did not return an event secret');
      }
      this.deviceUUID = res.id;
      this.deviceEventSecret = res.eventSecret;
      try {
        await this.config.storeDeviceUUID(res.id);
        await this.config.storeDeviceEventSecret(res.eventSecret);
        // Persist the owning userId so handleLoginSuccess can detect
        // account-switch vs same-user re-auth and avoid bricking the
        // latter behind the support-token recovery wall.
        await this.config.storeDeviceUserId(res.userId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[WaitLayer] Failed to persist device registration: ${msg}`);
      }
      return res.id;
    }
    throw new Error('Failed to register device');
  }

  async waitStateStart(input: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    toolType: string;
    idempotencyKey: string;
    signals: WaitSignal[];
    detectorVersion: string;
    evidence?: Omit<
      DetectorEvidence,
      'signature' | 'detectorVersion' | 'waitStateId' | 'sessionId'
    >[];
  }): Promise<void> {
    const evidence: DetectorEvidence[] = [];
    if (input.evidence) {
      const secret = this.deviceEventSecret ?? (await this.config.getDeviceEventSecret());
      if (!secret) {
        throw new Error('WaitLayer device is not registered with an event secret.');
      }
      for (const item of input.evidence) {
        const signed: Omit<DetectorEvidence, 'signature'> = {
          ...item,
          detectorVersion: DETECTOR_VERSION,
          waitStateId: input.waitStateId,
          sessionId: input.sessionId,
        };
        evidence.push({ ...signed, signature: signEvidence(signed, secret) });
      }
    }
    const payload = {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      toolType: input.toolType,
      waitStateId: input.waitStateId,
      idempotencyKey: input.idempotencyKey,
      signals: input.signals,
      detectorVersion: input.detectorVersion,
      ...(evidence.length > 0 ? { evidence } : {}),
    };
    await this.post('/extension/wait-state/start', {
      ...payload,
      signature: await this.signEventPayload(payload),
    });
  }

  async waitStateEnd(input: {
    waitStateId: string;
    durationSeconds: number;
    idempotencyKey: string;
  }): Promise<void> {
    const payload = {
      waitStateId: input.waitStateId,
      durationSeconds: String(input.durationSeconds),
      idempotencyKey: input.idempotencyKey,
    };
    await this.post('/extension/wait-state/end', {
      ...payload,
      signature: await this.signEventPayload(payload),
    });
  }
  /**
   * Flag a wait state as a false positive. The flag is stored on the start
   * event server-side (ExtensionWaitTrait.flagFalsePositive →
   * POST /extension/wait-state/:waitStateId/false-positive) and feeds
   * detector-precision analytics. This is a developer action gated by the
   * Bearer token, so no event signature is required — mirror the simple
   * signed-POST-free calls and let `post` attach the auth header.
   */
  async flagFalsePositive(waitStateId: string, reason?: string): Promise<void> {
    const payload: Record<string, unknown> = {};
    // Optional free-text reason the developer gave when flagging the wait.
    // Omitted from the payload entirely when not provided, so older callers
    // (and server builds) that don't expect it stay backward compatible.
    if (reason !== undefined) payload.reason = reason;
    await this.post(`/extension/wait-state/${waitStateId}/false-positive`, payload);
  }

  async requestAd(input: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    toolType: string;
    idempotencyKey: string;
    country?: string;
  }): Promise<ServerAdResponse> {
    // A-056: include a best-effort country code for privacy-safe country
    // targeting. The server falls back to the profile country when omitted.
    const country = input.country ?? detectCountryCode();
    const payload = {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      waitStateId: input.waitStateId,
      toolType: input.toolType,
      idempotencyKey: input.idempotencyKey,
      ...(country ? { country } : {}),
    };
    const res = await this.post<ServerAdResponse>('/extension/ad-request', {
      ...payload,
      signature: await this.signEventPayload(payload),
    });
    return res ?? { ad: null };
  }

  async recordAdRendered(input: {
    impressionToken: string;
    renderedAt: string;
    idempotencyKey: string;
  }): Promise<void> {
    const payload = {
      impressionToken: input.impressionToken,
      renderedAt: input.renderedAt,
      idempotencyKey: input.idempotencyKey,
    };
    await this.post('/extension/ad-rendered', {
      ...payload,
      signature: await this.signEventPayload(payload),
    });
  }

  async recordImpressionEnd(impressionToken: string, visibleDurationMs: number): Promise<void> {
    const payload = {
      impressionToken,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs,
      idempotencyKey: `imp-${impressionToken}`,
    };
    await this.post('/extension/impression-qualified', {
      ...payload,
      signature: await this.signEventPayload(payload),
    });
  }

  async recordClick(impressionToken: string): Promise<void> {
    const payload = {
      impressionToken,
      clickedAt: new Date().toISOString(),
      idempotencyKey: `click-${impressionToken}`,
    };
    await this.post('/extension/click', {
      ...payload,
      signature: await this.signEventPayload(payload),
    });
  }
  /** Normalize a raw per-currency map (number|string values) into the
   *  `Record<string, string>` shape the `Balance` DTO exposes — stringified
   *  exact bigints, matching how the API serializes BigInt columns. */
  private byCurrencyToStrings(
    raw: Record<string, number | string> | undefined,
  ): Record<string, string> | undefined {
    if (!raw) return undefined;
    const out: Record<string, string> = {};
    for (const [currency, value] of Object.entries(raw)) {
      out[currency] = parseMinor(value).toString();
    }
    return out;
  }

  async getBalance(): Promise<Balance> {
    // Backend returns flat { available, pending, total, paidOut } (no data wrapper).
    // Monetary BigInt columns are serialized as strings; parse them back to
    // bigints. Each entry also carries an optional `byCurrency` map of
    // per-currency minor-unit totals (also serialized as decimal strings),
    // which we preserve as a `Record<string, string>` for the UI.
    const res = await this.get<RawBalance>('/ledger/balance');
    return {
      available: {
        amountMinor: parseMinor(res.available.amountMinor),
        currency: res.available.currency,
        byCurrency: this.byCurrencyToStrings(res.available.byCurrency),
      },
      pending: {
        amountMinor: parseMinor(res.pending.amountMinor),
        currency: res.pending.currency,
        byCurrency: this.byCurrencyToStrings(res.pending.byCurrency),
      },
      total: {
        amountMinor: parseMinor(res.total.amountMinor),
        currency: res.total.currency,
        byCurrency: this.byCurrencyToStrings(res.total.byCurrency),
      },
      paidOut: {
        amountMinor: parseMinor(res.paidOut.amountMinor),
        currency: res.paidOut.currency,
        byCurrency: this.byCurrencyToStrings(res.paidOut.byCurrency),
      },
    };
  }

  /**
   * Update the developer's adsEnabled preference on the server.
   * Client-side toggles persist locally but must ALSO update the server
   * so the source of truth stays authoritative (P0 — Unify consent).
   */
  async updateAdsEnabled(enabled: boolean): Promise<void> {
    await this.patch('/developer/settings', { adsEnabled: enabled });
  }

  /**
   * Fetch the current developer settings from the server (incl. adsEnabled).
   * Used after login to sync local consent with server state.
   */
  async getDeveloperSettings(): Promise<{ adsEnabled: boolean }> {
    return this.get<{ adsEnabled: boolean }>('/developer/settings');
  }

  async promptLogin(): Promise<boolean> {
    const email = await vscode.window.showInputBox({ prompt: 'Email' });
    if (!email) return false;
    const password = await vscode.window.showInputBox({
      prompt: 'Password',
      password: true,
    });
    if (!password) return false;

    try {
      // First attempt: try normal login without TOTP
      const res = await this.post<{
        accessToken: string;
        refreshToken: string;
        user: { id: string };
      }>('/auth/login', {
        email,
        password,
      });
      await this.handleLoginSuccess(res);
      return true;
    } catch (err) {
      // The backend emits a structured 2FA challenge ({ twoFactorRequired: true })
      // when a TOTP-protected account logs in without a code, and a generic
      // "Invalid two-factor authentication code" when a wrong code is supplied.
      // Detect either case so we can prompt for the code and resubmit.
      const errBody = isRecord(err) ? err : {};
      const is2fa =
        errBody.twoFactorRequired === true ||
        errBody.message === 'Invalid two-factor authentication code';
      if (is2fa) {
        const twoFactorToken = await vscode.window.showInputBox({
          prompt: 'Enter 6-digit Two-Factor Authentication (2FA) Code',
          placeHolder: '123456',
          password: true,
          ignoreFocusOut: true,
        });
        if (!twoFactorToken) {
          vscode.window.showWarningMessage('WaitLayer: login cancelled — 2FA code required');
          return false;
        }
        try {
          const res = await this.post<{
            accessToken: string;
            refreshToken: string;
            user: { id: string };
          }>('/auth/login', { email, password, twoFactorToken });
          await this.handleLoginSuccess(res);
          return true;
        } catch (err2: unknown) {
          vscode.window.showErrorMessage(
            `WaitLayer: login failed — ${getRequestErrorMessage(err2)}`,
          );
          return false;
        }
      } else {
        vscode.window.showErrorMessage(`WaitLayer: login failed — ${getRequestErrorMessage(err)}`);
        return false;
      }
    }
  }

  private async handleLoginSuccess(res: {
    accessToken: string;
    refreshToken: string;
    user?: { id?: string };
  }): Promise<void> {
    await this._initialized;
    const tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken };

    // ── Device registration handling across login/logout cycles ──
    // The device is bound to (userId + machine fingerprint). When the
    // SAME user logs out and back in, the device registration should
    // survive — we present `existingEventSecret` to the backend for a
    // clean proof-of-possession pass, avoiding the support-token
    // recovery wall. When a DIFFERENT user logs into the same machine,
    // we clear the previous user's device registration so the new user
    // gets a fresh device row + event secret.
    const newUserId = res.user?.id;
    let storedDeviceUserId: string | null = null;
    try {
      storedDeviceUserId = await this.config.getDeviceUserId();
    } catch {
      // A failed ownership read is treated as an account switch below.
    }
    if (!(newUserId && storedDeviceUserId === newUserId)) {
      // Different user, missing ownership, or a failed ownership read: clear
      // stale device data before the new credentials become request-visible.
      this.deviceUUID = null;
      this.deviceEventSecret = null;
      await this.config.clearDeviceRegistration();
    }

    // Persist before making the new credentials available to request callers.
    await this.config.storeTokens(tokens);
    this.currentTokens = tokens;
    vscode.window.showInformationMessage('WaitLayer: logged in');
  }

  async logout(): Promise<void> {
    try {
      await this.post('/auth/logout', {});
    } catch {
      // Local cleanup must still happen if the access token has already expired.
    } finally {
      this.currentTokens = null;
      // Keep device registration across logout cycles: the physical machine
      // is the same, and on same-user re-login the stored eventSecret
      // provides proof-of-possession, avoiding the support-token recovery
      // wall. On a DIFFERENT-user login, handleLoginSuccess detects the
      // userId mismatch and clears the stale registration then.
      await this.config.clearTokens();
    }
    vscode.window.showInformationMessage('WaitLayer: logged out');
  }

  // ── HTTP ──

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    skipAuth = false,
    options?: { skipRetry?: boolean },
  ): Promise<T> {
    const bodyStr = JSON.stringify(body);

    return this.request<T>(
      'POST',
      path,
      headers(path, bodyStr),
      bodyStr,
      skipAuth,
      options?.skipRetry,
    );
  }

  private async patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(
      'PATCH',
      path,
      { 'Content-Type': 'application/json' },
      JSON.stringify(body),
      false,
      false,
    );
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, { 'Content-Type': 'application/json' }, '', false, false);
  }

  private async request<T>(
    method: string,
    path: string,
    reqHeaders: Record<string, string>,
    body: string,
    skipAuth = false,
    skipRetry = false,
  ): Promise<T> {
    // Ensure tokens are loaded before first request
    await this._initialized;

    // Network-resilient retry (mirrors the gateway api-client `raw` wrapper, gap
    // #31). The detector loop fires every ad-request / adRendered /
    // recordImpressionEnd / recordClick synchronously inside the panel's
    // close/click callbacks — those billing events MUST survive a transient
    // blip (socket error, timeout, 429, 5xx) or the developer permanently
    // loses CPM/CPC revenue for that impression: the panel is already gone,
    // there is no second attempt at the call site. All event/recording
    // endpoints carry idempotency keys (server-side CAS), so re-sending is
    // safe — a duplicate delivery no-ops rather than double-charging. The
    // per-call 401 refresh-retry path inside _handleRetry is a SEPARATE layer
    // and intentionally excluded from this retry set (a 401 is an application
    // error, not a transient failure). Application 4xx are not retried.
    // Skipping transient-retry for auth-refresh: the server rotates the token
    // family on the first success (CAS revoke of the old jti). A lost ACK
    // followed by a re-send of the same pre-rotation refresh token triggers
    // server-side full-family revocation.
    const MAX_ATTEMPTS = skipRetry ? 1 : 3;
    for (let attempt = 1; ; attempt++) {
      // Rebuild the auth header on each attempt — the access token may have
      // been refreshed by a 401 retry on a PRIOR attempt in this loop, and we
      // must pin the freshest token into the headers before sending.
      await this._initialized;
      const authHeaders: Record<string, string> = {};
      if (!skipAuth && this.currentTokens?.accessToken) {
        authHeaders['Authorization'] = `Bearer ${this.currentTokens.accessToken}`;
      }
      try {
        return await new Promise<T>((resolve, reject) => {
          this._doRequest(
            method,
            path,
            { ...reqHeaders, ...authHeaders },
            body,
            resolve,
            reject,
            false,
            skipAuth,
          );
        });
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || !isRetryableError(err)) throw err;
        const backoffMs = Math.min(500 * 2 ** (attempt - 1), 8000);
        await sleep(backoffMs);
      }
    }
  }

  private _doRequest<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string,
    resolve: (value: T) => void,
    reject: (reason: unknown) => void,
    isRetry = false,
    skipAuth = false,
  ): void {
    let url: URL;
    try {
      url = resolveCredentialSafeUrl(this.config.getApiUrl(), path);
    } catch (err) {
      reject(err);
      return;
    }
    const requestHostname = requestHostnameForUrl(url);
    const transport = url.protocol === 'https:' ? https : http;
    // bound DNS resolution explicitly. `req.setTimeout` covers the
    // established-connection wall clock but NOT the DNS lookup phase. A hung
    // resolver (misconfigured /etc/resolv.conf, unreachable DNS server, captive
    // portal) would block every extension API call indefinitely — and because
    // ad-panel lifecycle callbacks fire these synchronously, a single hung
    // socket freezes the entire ad-serving pipeline until VS Code is restarted.
    // This mirrors the CLI `lookupWithTimeout` fix.
    const lookupWithTimeout = (
      hostname: string,
      _options: dns.LookupOptions,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number,
      ) => void,
    ) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const err: NodeJS.ErrnoException = new Error(`DNS resolution timed out for ${hostname}`);
        err.code = 'DNSLOOKUP_TIMEOUT';
        cb(err, '', 4);
      }, 5_000);
      dns.lookup(hostname, _options, (err, address, family) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          cb(err, '', 4);
          return;
        }
        // Node's lookup contract: the caller selects the result shape via the
        // `all` option. `dns.lookup` already returns an array when `all: true`
        // and a string otherwise, so forward it unchanged. The prior code
        // collapsed the array to `address[0]?.address` and dropped `family`,
        // which fed `onlookupall` a single string and threw
        // "Invalid IP address: undefined" against a live host.
        if (typeof address === 'string') {
          cb(null, address, family);
        } else {
          cb(null, address);
        }
      });
    };
    const req = transport.request(
      {
        method,
        hostname: requestHostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        lookup: lookupWithTimeout,
        headers: {
          ...headers,
          'X-Extension-Version': '0.0.1',
          'X-Tool-Type': 'vscode',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
          try {
            const parsed = data.length ? JSON.parse(data) : {};

            // On 401, try token refresh and retry once (skip for auth endpoints
            // except /auth/logout — a stale access token should still be
            // refreshed so the server-side session is actually revoked)
            if (
              res.statusCode === 401 &&
              !isRetry &&
              !skipAuth &&
              (!path.includes('/auth/') || path === '/auth/logout')
            ) {
              const newTokens = await this.refreshTokens();
              if (newTokens) {
                // Rebuild headers with new access token (replacing any old auth header)
                const { Authorization: _, ...restHeaders } = headers;
                const retryHeaders = {
                  ...restHeaders,
                  Authorization: `Bearer ${newTokens.accessToken}`,
                };
                this._doRequest(method, path, retryHeaders, body, resolve, reject, true);
                return;
              }
            }

            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed as T);
            } else {
              // Inject the raw HTTP status into the rejected body so the
              // transient-retry wrapper's isRetryableError() can branch on
              // 429/5xx even when the server's JSON body omits or spells
              // `statusCode` differently (the CLI does the same at
              // attemptRaw's reject: `{ status: res.statusCode, ... }`).
              if (isRecord(parsed)) {
                reject({ statusCode: res.statusCode, ...parsed });
              } else {
                reject({ statusCode: res.statusCode, message: 'request failed' });
              }
            }
          } catch (e: unknown) {
            reject(e);
          }
        });
      },
    );
    // ── Connection timeout ─────────────────────────────────────────────────
    // The Node CLI added a 30s guard (apps/cli/src/lib/api-client.ts) so a
    // stalled TCP connection doesn't hang the entire client indefinitely.
    // The detector loop here fires ad-request / recordAdRendered /
    // recordImpressionEnd synchronously; a single hung socket would freeze
    // ad serving until the user restarts VS Code unless we surface the
    // failure. Mirror the CLI's behavior with a 30s wall-clock cap.
    req.setTimeout(30_000, () => {
      req.destroy(new Error('WaitLayer request timed out after 30s (no response from server)'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  }
}

function headers(path: string, bodyStr: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr).toString(),
    'X-Extension-Version': '0.0.1',
    'X-Tool-Type': 'vscode',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequestErrorMessage(err: unknown): string {
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Whether a request failure is transient enough to retry (mirrors the CLI's
 *  isRetryableError). Socket-level failures arrive as Error instances (codes
 *  like ECONNRESET, ETIMEDOUT, ECONNREFUSED, ENOTFOUND, EAI_AGAIN,
 *  ECONNABORTED); HTTP-level failures are non-2xx responses that the client
 *  rejects as the parsed body object, which carries `statusCode` from Nest.
 *  Retry 429 and any 5xx; do NOT retry application 4xx (auth, validation) —
 *  those are the server telling us the request itself is wrong, and retrying
 *  a 4xx double-writes where the server can't dedupe (e.g. auth/signup). */
function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code &&
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNABORTED',
      ].includes(code)
    ) {
      return true;
    }
    // The 30s wall-clock timeout surfaces an Error with a recognizable message
    // ('WaitLayer request timed out after 30s...'). Retry once on a fresh socket.
    if (err.message && err.message.toLowerCase().includes('timed out')) return true;
    return false;
  }
  if (isRecord(err)) {
    const status = typeof err.statusCode === 'number' ? err.statusCode : undefined;
    if (status !== undefined && (status === 429 || status >= 500)) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function isDeviceRecoveryError(err: unknown): boolean {
  const message = getRequestErrorMessage(err);
  return (
    message.includes('Cannot recover device secret') ||
    message.includes('device recovery') ||
    message.includes('Device recovery') ||
    message.includes('Support recovery token') ||
    message.includes('Provide only one device recovery proof')
  );
}

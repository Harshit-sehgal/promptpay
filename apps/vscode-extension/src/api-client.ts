import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

import { signPayload } from '@waitlayer/shared';

import { ConfigurationManager } from './config';
import { requestHostnameForUrl, resolveCredentialSafeUrl } from './transport-policy';

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
  amountMinor: number;
  currency: string;
}

/** Backend returns { available, pending, total, paidOut } each as { amountMinor, currency }. */
export interface Balance {
  available: AmountEntry;
  pending: AmountEntry;
  total: AmountEntry;
  paidOut: AmountEntry;
}

interface ServerAdResponse {
  ad: Ad | null;
}

interface RegisterDeviceResponse {
  id: string;
  eventSecret?: string;
}

export class ApiClient {
  private currentTokens: { accessToken?: string; refreshToken?: string } | null = null;
  private _refreshInProgress: Promise<{ accessToken: string; refreshToken: string } | null> | null = null;
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
      throw new Error('WaitLayer device is not registered with an event secret. Re-run device registration.');
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
        // Backend returns flat { accessToken, refreshToken } — no data wrapper
        const tokens = await this.post<{ accessToken: string; refreshToken: string }>(
          '/auth/refresh',
          { refreshToken: this.currentTokens!.refreshToken },
          true, // skipAuth: don't attach Authorization header for refresh itself
        );
        // Update in-memory and persist
        this.currentTokens = tokens;
        void this.config.storeTokens(tokens);
        return tokens;
      } catch {
        // Refresh failed — clear tokens
        this.currentTokens = null;
        void this.config.clearTokens();
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
      res = await this.post<RegisterDeviceResponse>('/extension/register-device', registrationPayload);
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
  }): Promise<void> {
    const payload = {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      toolType: input.toolType,
      waitStateId: input.waitStateId,
      idempotencyKey: input.idempotencyKey,
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

  async requestAd(input: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    toolType: string;
    idempotencyKey: string;
    country?: string;
  }): Promise<Ad | null> {
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
    return res?.ad ?? null;
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

  async getBalance(): Promise<Balance> {
    // Backend returns flat { available, pending, total, paidOut } (no data wrapper)
    return this.get<Balance>('/ledger/balance');
  }

  async promptLogin(): Promise<void> {
    const email = await vscode.window.showInputBox({ prompt: 'Email' });
    if (!email) return;
    const password = await vscode.window.showInputBox({
      prompt: 'Password',
      password: true,
    });
    if (!password) return;

    try {
      // First attempt: try normal login without TOTP
      const res = await this.post<{ accessToken: string; refreshToken: string }>(
        '/auth/login',
        { email, password },
      );
      await this.handleLoginSuccess(res);
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
          return;
        }
        try {
          const res = await this.post<{ accessToken: string; refreshToken: string }>(
            '/auth/login',
            { email, password, twoFactorToken },
          );
          await this.handleLoginSuccess(res);
        } catch (err2: unknown) {
          vscode.window.showErrorMessage(
            `WaitLayer: login failed — ${getRequestErrorMessage(err2)}`,
          );
        }
      } else {
        vscode.window.showErrorMessage(
          `WaitLayer: login failed — ${getRequestErrorMessage(err)}`,
        );
      }
    }
  }

  private async handleLoginSuccess(res: { accessToken: string; refreshToken: string }): Promise<void> {
    const tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken };
    this.currentTokens = tokens;
    this.deviceUUID = null;
    this.deviceEventSecret = null;
    // Persist tokens so they survive extension restarts
    this.config.storeTokens(tokens).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[WaitLayer] Failed to persist tokens after login: ${msg}`);
    });
    this.config.clearDeviceRegistration().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[WaitLayer] Failed to clear device registration: ${msg}`);
    });
    vscode.window.showInformationMessage('WaitLayer: logged in');
  }

  async logout(): Promise<void> {
    try {
      await this.post('/auth/logout', {});
    } catch {
      // Local cleanup must still happen if the access token has already expired.
    } finally {
      this.currentTokens = null;
      this.deviceUUID = null;
      this.deviceEventSecret = null;
      void this.config.clearTokens();
      void this.config.clearDeviceRegistration();
    }
    vscode.window.showInformationMessage('WaitLayer: logged out');
  }

  // ── HTTP ──

  private async post<T>(path: string, body: Record<string, unknown>, skipAuth = false): Promise<T> {
    const bodyStr = JSON.stringify(body);

    return this.request<T>(
      'POST',
      path,
      headers(path, bodyStr),
      bodyStr,
      skipAuth,
    );
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, { 'Content-Type': 'application/json' }, '');
  }

  private async request<T>(
    method: string,
    path: string,
    reqHeaders: Record<string, string>,
    body: string,
    skipAuth = false,
  ): Promise<T> {
    // Ensure tokens are loaded before first request
    await this._initialized;

    // Build auth header (skip for refresh endpoint itself)
    const authHeaders: Record<string, string> = {};
    if (!skipAuth && this.currentTokens?.accessToken) {
      authHeaders['Authorization'] = `Bearer ${this.currentTokens.accessToken}`;
    }

    return new Promise((resolve, reject) => {
      this._doRequest(method, path, { ...reqHeaders, ...authHeaders }, body, resolve, reject, false, skipAuth);
    });
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
    const req = transport.request(
      {
        method,
        hostname: requestHostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
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

            // On 401, try token refresh and retry once (skip for auth endpoints)
            if (
              res.statusCode === 401 &&
              !isRetry &&
              !skipAuth &&
              !path.includes('/auth/')
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
              reject(parsed);
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

function headers(
  path: string,
  bodyStr: string,
): Record<string, string> {
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

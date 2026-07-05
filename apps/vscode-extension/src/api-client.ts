import * as https from 'https';
import * as http from 'http';
import * as vscode from 'vscode';
import { signPayload } from '@waitlayer/shared';
import { ConfigurationManager } from './config';

export interface Ad {
  impressionToken: string;
  campaignId: string;
  creativeId: string;
  title: string;
  message: string;
  label: string;
  displayDomain: string;
  destinationUrl: string;
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
  /** Cached signing secret. Refreshed whenever `deviceEventSecret` changes
   *  (after device registration). Set in the constructor's init promise so
   *  the sign() method can stay synchronous. */
  private _signingSecret: string | null = null;

  constructor(private config: ConfigurationManager) {
    // Load persisted auth and device signing state from SecretStorage on construction.
    this._initialized = Promise.all([
      this.config.getTokens(),
      this.config.getDeviceEventSecret(),
      this.config.getSecretKey(),
    ]).then(([tokens, eventSecret, signingKey]) => {
      if (tokens) this.currentTokens = tokens;
      this.deviceEventSecret = eventSecret;
      this._signingSecret = signingKey;
    });
  }

  /** Sign payload object with HMAC using canonical JSON (sorted keys).
   *  Event requests prefer the per-device secret issued at registration.
   *  The configured global secret remains only as a compatibility fallback.
   *  If neither is available yet (init still in-flight), sign with an empty
   *  placeholder so callers don't throw — the server will reject any signature
   *  mismatch with 401, leaving the request fail-closed rather than fail-open.
   *
   *  Async so that callers constructing payload bodies always await the init
   *  promise — otherwise `waitStateStart`/`requestAd`/etc. call `sign()` during
   *  synchronous payload construction (lines 161, 177, 197, etc.) before the
   *  Promise.all in `_initialized` has resolved, signing with an empty secret. */
  async sign(payload: Record<string, unknown>): Promise<string> {
    await this._initialized;
    const secret = this.deviceEventSecret ?? this._signingSecret ?? '';
    return signPayload(payload, secret);
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
        this.config.storeTokens(tokens).catch(() => {});
        return tokens;
      } catch {
        // Refresh failed — clear tokens
        this.currentTokens = null;
        this.config.clearTokens().catch(() => {});
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
    } catch {}

    const fingerprint = await this.config.getDeviceFingerprint();
    const res = await this.post<RegisterDeviceResponse>('/extension/register-device', {
      toolType: 'vscode',
      fingerprintHash: fingerprint,
      extensionVersion: '0.0.1',
      platform: process.platform || 'unknown',
    });

    if (res && res.id) {
      this.deviceUUID = res.id;
      this.deviceEventSecret = res.eventSecret ?? null;
      try {
        await this.config.storeDeviceUUID(res.id);
        if (res.eventSecret) {
          await this.config.storeDeviceEventSecret(res.eventSecret);
        }
      } catch {}
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
      signature: await this.sign(payload),
    });
  }

  async waitStateEnd(input: {
    waitStateId: string;
    durationMs: number;
    idempotencyKey: string;
  }): Promise<void> {
    const payload = {
      waitStateId: input.waitStateId,
      duration: String(input.durationMs),
      idempotencyKey: input.idempotencyKey,
    };
    await this.post('/extension/wait-state/end', {
      ...payload,
      signature: await this.sign(payload),
    });
  }

  async requestAd(input: {
    deviceId: string;
    sessionId: string;
    waitStateId: string;
    toolType: string;
    idempotencyKey: string;
  }): Promise<Ad | null> {
    const payload = {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      waitStateId: input.waitStateId,
      toolType: input.toolType,
      idempotencyKey: input.idempotencyKey,
    };
    const res = await this.post<ServerAdResponse>('/extension/ad-request', {
      ...payload,
      signature: await this.sign(payload),
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
      signature: await this.sign(payload),
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
      signature: await this.sign(payload),
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
      signature: await this.sign(payload),
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
      // Backend returns flat { user, accessToken, refreshToken } — no data wrapper
      const res = await this.post<{ accessToken: string; refreshToken: string }>(
        '/auth/login',
        { email, password },
      );
      const tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken };
      this.currentTokens = tokens;
      this.deviceUUID = null;
      this.deviceEventSecret = null;
      // Persist tokens so they survive extension restarts
      this.config.storeTokens(tokens).catch(() => {});
      this.config.clearDeviceRegistration().catch(() => {});
      vscode.window.showInformationMessage('WaitLayer: logged in');
    } catch {
      vscode.window.showErrorMessage('WaitLayer: login failed');
    }
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
      this.config.clearTokens().catch(() => {});
      this.config.clearDeviceRegistration().catch(() => {});
    }
    vscode.window.showInformationMessage('WaitLayer: logged out');
  }

  // ── HTTP ──

  private url(path: string): string {
    return `${this.config.getApiUrl()}${path}`;
  }

  private async post<T>(path: string, body: Record<string, unknown>, skipAuth = false): Promise<T> {
    const bodyStr = JSON.stringify(body);

    // Compute header signature from canonical form WITHOUT the signature field
    let headerSignature: string | undefined;
    if (body) {
      const { signature: _, ...payloadForHeader } = body;
      headerSignature = await this.sign(payloadForHeader);
    }

    return this.request<T>(
      'POST',
      path,
      headers(path, bodyStr, headerSignature),
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
    const url = new URL(path.startsWith('http') ? path : this.url(path));
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
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
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  }
}

function headers(
  path: string,
  bodyStr: string,
  headerSignature?: string,
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr).toString(),
    'X-Extension-Version': '0.0.1',
    'X-Tool-Type': 'vscode',
  };
  if (headerSignature) {
    base['X-WaitLayer-Signature'] = headerSignature;
  }
  return base;
}

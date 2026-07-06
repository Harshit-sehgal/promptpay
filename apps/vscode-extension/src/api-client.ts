import * as https from 'https';
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[WaitLayer] Failed to read stored device UUID/secret: ${msg}`);
    }

    const fingerprint = await this.config.getDeviceFingerprint();
    const res = await this.post<RegisterDeviceResponse>('/extension/register-device', {
      toolType: 'vscode',
      fingerprintHash: fingerprint,
      extensionVersion: '0.0.1',
      platform: process.platform || 'unknown',
    });

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
      signature: await this.signEventPayload(payload),
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
      this.config.storeTokens(tokens).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[WaitLayer] Failed to persist tokens after login: ${msg}`);
      });
      this.config.clearDeviceRegistration().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[WaitLayer] Failed to clear device registration: ${msg}`);
      });
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
    const url = new URL(path.startsWith('http') ? path : this.url(path));
    // ── HTTPS-only enforcement (defense in depth) ───────────────────────────
    // The Bearer access/refresh tokens and optional per-device event signature
    // travel in the Authorization/X-WaitLayer-* / request-body envelope.
    // Sending those over plaintext HTTP would let an
    // on-path attacker recover a long-lived refresh token (30d) and forge
    // every subsequent event/wait-state/ad payload.
    //
    // EXCEPTION: localhost and 127.* hosts are allowed over plain HTTP for
    // local development (the default apiUrl is 'http://localhost:4000/api/v1').
    //
    // Fail closed the moment we discover an http:// origin for a non-local
    // hostname. If the user (or an attacker with workspace write access —
    // any other extension can update `waitlayer.apiUrl` to an http URL) has
    // configured the extension to connect over plain HTTP to a remote host,
    // reject at the socket-binding decision before any data is written.
    const hostname = url.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.startsWith('127.');
    if (url.protocol !== 'https:' && !isLocalHost) {
      reject(
        new Error(
          `WaitLayer refuses to send credentials over ${url.protocol} to host '${hostname}'. ` +
          `The apiUrl must be https:// for remote hosts. Set the VS Code setting ` +
          `'waitlayer.apiUrl' to a secure origin.`,
        ),
      );
      return;
    }
    const transport = https;
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

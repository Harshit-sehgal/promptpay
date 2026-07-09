import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';

import { Credentials, getCredentials, getDeviceEventSecret,setCredentials, storeDeviceEventSecret } from './credentials';
import { signPayload } from './signing';
import { normalizeToolType } from './tool-types';

const PRODUCTION_API_URL = 'https://api.waitlayer.com/api/v1';

/**
 * Resolve the API base URL for the CLI. Packaged/distributed clients default
 * to the production SaaS origin so an installed CLI can reach the real API
 * without manual configuration. Local development overrides via
 * `WAITLAYER_API_URL`, and `NODE_ENV=production` is an explicit opt-in to the
 * production origin (A-013). We never fall back to localhost for a packaged
 * install — that would silently point real users at their own machine.
 */
export function resolveApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WAITLAYER_API_URL) return env.WAITLAYER_API_URL;
  if (env.NODE_ENV === 'production') return PRODUCTION_API_URL;
  return PRODUCTION_API_URL;
}

const API_URL = resolveApiBaseUrl();

/**
 * Best-effort ISO-3166-1 alpha-2 country code from the host locale (e.g.
 * `en_US.UTF-8` -> `US`). Used for privacy-safe, developer-opt-in country
 * targeting (A-056). Returns undefined when no locale-derived country is
 * available; the server falls back to the profile country.
 */
export function detectCountryCode(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? env.LANGUAGE;
  if (!raw) return undefined;
  const match = raw.split(/[.\s]/)[0]?.split('_')[1];
  if (match && /^[A-Za-z]{2}$/.test(match)) return match.toUpperCase();
  return undefined;
}

interface RegisterDeviceResponse {
  id: string;
  eventSecret?: string;
}

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

export class ApiClient {
  private deviceUUID: string | null = null;
  private deviceEventSecret: string | null = null;

  constructor(private creds: Credentials | null = null) {
    if (!this.creds) this.creds = getCredentials();
    if (this.creds?.deviceUUID) this.deviceUUID = this.creds.deviceUUID;
    // Event secret is NOT in the JSON credential file (it's in the OS keychain
    // when available, else a separate obfuscated file). Loaded lazily on first
    // signing; see signEventPayload().
    this.deviceEventSecret = null;
  }

  /** Sign event payloads with the server-issued per-device secret only. */
  private async signEventPayload(payload: Record<string, unknown>): Promise<string> {
    if (!this.deviceEventSecret) {
      this.deviceEventSecret = await getDeviceEventSecret();
    }
    if (!this.deviceEventSecret) {
      throw new Error('WaitLayer device is not registered with an event secret. Run device registration again.');
    }
    return signPayload(payload, this.deviceEventSecret);
  }

  /** Event payloads are signed in-body; no separate header signature is sent. */

  async getOrRegisterDevice(): Promise<string> {
    if (this.deviceUUID && this.deviceEventSecret) return this.deviceUUID;

    const hostname = os.hostname();
    const username = os.userInfo().username;
    const homedir = os.homedir();
    const platform = os.platform();
    const arch = os.arch();
    const ostype = os.type();
    const osrelease = os.release();
    const totalMemGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const fingerprint = crypto
      .createHash('sha256')
      .update(`cli-${hostname}-${username}-${platform}-${arch}-${homedir}-${ostype}-${osrelease}-${totalMemGb}`)
      .digest('hex');
    const recoverySupportToken = process.env.WAITLAYER_DEVICE_RECOVERY_TOKEN?.trim();
    const registrationPayload = {
      toolType: 'terminal',
      fingerprintHash: fingerprint,
      extensionVersion: '0.0.1',
      platform: os.platform() || 'unknown',
      ...(this.deviceEventSecret ? { existingEventSecret: this.deviceEventSecret } : {}),
      ...(recoverySupportToken ? { recoverySupportToken } : {}),
    };

    let res: RegisterDeviceResponse;
    try {
      res = await this.raw<RegisterDeviceResponse>('POST', '/extension/register-device', registrationPayload);
    } catch (err: unknown) {
      if (isDeviceRecoveryError(err) && !recoverySupportToken) {
        throw new Error(
          `${getRequestErrorMessage(err)}. ` +
          'If support issued a device recovery token, rerun with WAITLAYER_DEVICE_RECOVERY_TOKEN set to that one-time token.',
        );
      }
      throw err;
    }

    if (res && res.id) {
      if (!res.eventSecret) {
        throw new Error('Device registration did not return an event secret');
      }
      this.deviceUUID = res.id;
      this.deviceEventSecret = res.eventSecret;
      if (this.creds) {
        this.creds.deviceUUID = res.id;
        setCredentials(this.creds);
      }
      // Persist the event secret separately (not in the main credential JSON).
      await storeDeviceEventSecret(res.eventSecret);
      return res.id;
    }
    throw new Error('Failed to register CLI device');
  }

  async login(input: { email: string; password: string; twoFactorToken?: string }) {
    const res = await this.raw<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; role: string; referralCode?: string };
    }>('POST', '/auth/login', input);
    return res;
  }

  async signup(input: {
    email: string;
    password: string;
    role: string;
    name?: string;
    referrerCode?: string;
    ageConfirmed?: boolean;
    termsAccepted?: boolean;
    policyVersion?: string;
  }) {
    const res = await this.raw<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; role: string; referralCode?: string };
    }>('POST', '/auth/signup', input);
    return res;
  }

  async getBalance() {
    // Backend returns { available: { amountMinor, currency }, pending: {...}, total: {...}, paidOut: {...} }
    const res = await this.raw<{
      available: { amountMinor: number; currency: string };
      pending: { amountMinor: number; currency: string };
      total: { amountMinor: number; currency: string };
      paidOut: { amountMinor: number; currency: string };
    }>('GET', '/ledger/balance', undefined);
    return res;
  }

  async getRequiredConsentVersions(): Promise<Record<string, string> | null> {
    return this.raw<Record<string, string>>('GET', '/consent/required-versions');
  }

  async getOverview() {
    // Backend returns full dashboard: { estimatedEarnings, confirmedEarnings, pendingEarnings, heldEarnings, availableForPayout, lifetimeEarnings, trustLevel, trustScore, settings }
    const res = await this.raw<{
      estimatedEarnings: number;
      confirmedEarnings: number;
      pendingEarnings: number;
      heldEarnings: number;
      availableForPayout: number;
      lifetimeEarnings: number;
      trustLevel: string;
      trustScore?: number;
    }>('GET', '/developer/dashboard', undefined);
    return res;
  }

  async getSettings() {
    return this.raw<{
      adsEnabled: boolean;
      quietMode: boolean;
      quietModeStart?: string;
      quietModeEnd?: string;
      maxAdsPerHour?: number;
      referralCode?: string;
      email: string;
      displayName?: string;
    }>('GET', '/developer/settings', undefined);
  }

  async updateSettings(data: Record<string, unknown>) {
    return this.raw<{
      adsEnabled: boolean;
      quietMode: boolean;
      quietModeStart?: string;
      quietModeEnd?: string;
      maxAdsPerHour?: number;
    }>('PATCH', '/developer/settings', data);
  }

  async reportWaitState(input: {
    deviceId: string;
    waitStateId: string;
    toolType: string;
    sessionId: string;
  }) {
    // Normalize tool name to a valid ToolType enum value.
    // Common tool names map to enum values; unrecognized ones default to 'terminal'.
    const normalizedTool = normalizeToolType(input.toolType);

    const payload = {
      deviceId: input.deviceId,
      waitStateId: input.waitStateId,
      toolType: normalizedTool,
      sessionId: input.sessionId,
      idempotencyKey: 'cli-start-' + input.waitStateId,
    };
    const signature = await this.signEventPayload(payload);
    return this.raw('POST', '/extension/wait-state/start', {
      ...payload,
      signature,
    });
  }

  async endWaitState(input: {
    waitStateId: string;
    durationSeconds: number;
  }) {
    const payload = {
      waitStateId: input.waitStateId,
      durationSeconds: String(input.durationSeconds),
      idempotencyKey: 'cli-end-' + input.waitStateId,
    };
    const signature = await this.signEventPayload(payload);
    return this.raw('POST', '/extension/wait-state/end', {
      ...payload,
      signature,
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
    // A-056: send a best-effort ISO country code so country-targeted campaigns
    // can be enforced without server-side geolocation. Falls back to the
    // developer's profile country server-side when omitted.
    const country = input.country ?? detectCountryCode();
    const payload = {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      waitStateId: input.waitStateId,
      toolType: input.toolType,
      idempotencyKey: input.idempotencyKey,
      ...(country ? { country } : {}),
    };
    const signature = await this.signEventPayload(payload);
    const res = await this.raw<{ ad: Ad | null }>('POST', '/extension/ad-request', {
      ...payload,
      signature,
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
    const signature = await this.signEventPayload(payload);
    await this.raw('POST', '/extension/ad-rendered', { ...payload, signature });
  }

  async recordImpressionQualified(input: {
    impressionToken: string;
    qualifiedAt: string;
    visibleDurationMs: number;
    idempotencyKey: string;
  }): Promise<void> {
    const payload = {
      impressionToken: input.impressionToken,
      qualifiedAt: input.qualifiedAt,
      visibleDurationMs: input.visibleDurationMs,
      idempotencyKey: input.idempotencyKey,
    };
    const signature = await this.signEventPayload(payload);
    await this.raw('POST', '/extension/impression-qualified', { ...payload, signature });
  }

  async recordClick(impressionToken: string): Promise<void> {
    const payload = {
      impressionToken,
      clickedAt: new Date().toISOString(),
      idempotencyKey: `click-${impressionToken}`,
    };
    const signature = await this.signEventPayload(payload);
    await this.raw('POST', '/extension/click', { ...payload, signature });
  }

  // Deduplicate concurrent refresh attempts — without this, two parallel
  // requests receiving 401s would each call /auth/refresh simultaneously.
  // The first call rotates the refresh token server-side; the second sees a
  // 401 on its now-stale refresh-token argument and both requests fail,
  // even though the first refresh succeeded. Matches the VSCode extension's
  // pattern (see apps/vscode-extension/src/api-client.ts refreshTokens).
  private _refreshInProgress: Promise<{ accessToken: string; refreshToken: string } | null> | null = null;

  private async refreshTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    if (!this.creds?.refreshToken) {
      return Promise.reject({ status: 401, message: 'No refresh token' });
    }
    if (this._refreshInProgress) return this._refreshInProgress;
    this._refreshInProgress = this._doRefresh();
    return this._refreshInProgress;
  }

  private async _doRefresh(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const refresh = await this.raw<{
        accessToken: string;
        refreshToken: string;
      }>('POST', '/auth/refresh', { refreshToken: this.creds!.refreshToken }, true);
      if (this.creds) {
        this.creds.accessToken = refresh.accessToken;
        this.creds.refreshToken = refresh.refreshToken;
        setCredentials(this.creds);
      }
      return refresh;
    } catch {
      return null;
    } finally {
      this._refreshInProgress = null;
    }
  }

  private async raw<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Record<string, unknown> | undefined,
    _isRefreshAttempt = false,
  ): Promise<T> {
    // No header signature: the body already carries `signature`, and the API
    // does not verify an X-WaitLayer-Signature header. Emitting one would
    // leak the per-device HMAC signing key to anyone reading headers
    // (proxies, browser DevTools, server access logs that capture headers).
    const isAbsoluteUrl = /^[a-z][a-z\d+\-.]*:\/\//i.test(path);
    const url = new URL(isAbsoluteUrl ? path : API_URL + path);
    const bodyStr = body ? JSON.stringify(body) : '';

    return new Promise<T>((resolve, reject) => {
      // Credentials must never traverse a real network in cleartext. Enforce
      // https: for any remote host. Loopback http (`localhost`, 127.0.0.1, ::1)
      // is the single safe exception: it never leaves the machine, so pointing
      // the CLI at a local dev server (WAITLAYER_API_URL=http://localhost:4002)
      // is permitted. Any other protocol is refused.
      const requestHostname =
        url.hostname.startsWith('[') && url.hostname.endsWith(']')
          ? url.hostname.slice(1, -1)
          : url.hostname;
      const isLoopback =
        requestHostname === 'localhost' || requestHostname === '127.0.0.1' || requestHostname === '::1';
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
        throw new Error(
          `CLI refuses to send credentials over ${url.protocol}. ` +
          'Set WAITLAYER_API_URL to an https:// endpoint, or http://localhost for local development.',
        );
      }
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          method,
          hostname: requestHostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr).toString(),
            ...(this.creds?.accessToken
              ? { Authorization: `Bearer ${this.creds.accessToken}` }
              : {}),
          },
        },
        async (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', async () => {
            try {
              const parsed = data.length ? JSON.parse(data) : {};
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(parsed as T);
              } else if (res.statusCode === 401 && this.creds?.refreshToken && !_isRefreshAttempt) {
                // Use deduplicated refresh — if a concurrent 401 is already
                // refreshing, this reuses the same in-flight request.
                const newTokens = await this.refreshTokens();
                if (newTokens) {
                  return this.raw<T>(method, path, body).then(resolve, reject);
                }
                reject({ status: 401, message: 'unauthorized' });
              } else {
                // NestJS returns { message, error, statusCode }
                const parsedObject = isRecord(parsed) ? parsed : {};
                const msg = typeof parsedObject.message === 'string' ? parsedObject.message : 'request failed';
                reject({ status: res.statusCode, message: msg, ...parsedObject });
              }
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy(new Error('Request timed out after 30s'));
      });
      if (body) req.write(bodyStr);
      req.end();
    });
  }
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

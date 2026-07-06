import * as crypto from 'crypto';
import * as os from 'os';
import * as https from 'https';
import { signPayload } from '@waitlayer/shared';
import { Credentials, getCredentials, setCredentials, storeDeviceEventSecret, getDeviceEventSecret } from './credentials';

const API_URL = process.env.WAITLAYER_API_URL ?? 'https://api.waitlayer.com/api/v1';

interface RegisterDeviceResponse {
  id: string;
  eventSecret?: string;
}

export class ApiClient {
  private deviceUUID: string | null = null;
  private deviceEventSecret: string | null = null;

  constructor(private creds: Credentials | null = null) {
    if (!this.creds) this.creds = getCredentials();
    if (this.creds?.deviceUUID) this.deviceUUID = this.creds.deviceUUID;
    // Event secret is NOT in the JSON credential file (it's in a separate
    // obfuscated file). Fetch from the dedicated helper.
    this.deviceEventSecret = getDeviceEventSecret();
  }

  /** Sign event payloads with the server-issued per-device secret only. */
  private signEventPayload(payload: Record<string, unknown>): string {
    if (!this.deviceEventSecret) {
      throw new Error('WaitLayer device is not registered with an event secret. Run device registration again.');
    }
    return signPayload(payload, this.deviceEventSecret);
  }

  /** Optional request-header signature. The API currently authorizes events
   *  through body signatures; omit this header until a device secret exists. */
  private signHeaderPayload(payload: Record<string, unknown>): string | undefined {
    if (!this.deviceEventSecret) return undefined;
    return signPayload(payload, this.deviceEventSecret);
  }

  async getOrRegisterDevice(): Promise<string> {
    if (this.deviceUUID && this.deviceEventSecret) return this.deviceUUID;

    const hostname = os.hostname();
    const fingerprint = crypto.createHash('sha256').update(`cli-${hostname}`).digest('hex');

    const res = await this.raw<RegisterDeviceResponse>('POST', '/extension/register-device', {
      toolType: 'terminal',
      fingerprintHash: fingerprint,
      extensionVersion: '0.0.1',
      platform: os.platform() || 'unknown',
    });

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
      storeDeviceEventSecret(res.eventSecret);
      return res.id;
    }
    throw new Error('Failed to register CLI device');
  }

  async login(input: { email: string; password: string }) {
    const res = await this.raw<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; role: string };
    }>('POST', '/auth/login', input);
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

  async reportWaitState(input: {
    deviceId: string;
    waitStateId: string;
    toolType: string;
  }) {
    // Normalize tool name to a valid ToolType enum value.
    // Common tool names map to enum values; unrecognized ones default to 'terminal'.
    const normalizedTool = normalizeToolType(input.toolType);

    const payload = {
      deviceId: input.deviceId,
      waitStateId: input.waitStateId,
      toolType: normalizedTool,
      sessionId: 'cli-' + Date.now(),
      idempotencyKey: 'cli-start-' + input.waitStateId,
    };
    const signature = this.signEventPayload(payload);
    return this.raw('POST', '/extension/wait-state/start', {
      ...payload,
      signature,
    });
  }

  async endWaitState(input: {
    waitStateId: string;
    durationMs: number;
  }) {
    const payload = {
      waitStateId: input.waitStateId,
      duration: String(input.durationMs),
      idempotencyKey: 'cli-end-' + input.waitStateId,
    };
    const signature = this.signEventPayload(payload);
    return this.raw('POST', '/extension/wait-state/end', {
      ...payload,
      signature,
    });
  }

  private async raw<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    /** Internal: when true, this call IS the refresh attempt — never recurse
     *  into another refresh on 401. Without this guard, an expired/invalid
     *  refresh token (server returns 401 on /auth/refresh) would cause unbounded
     *  recursion → stack overflow, because the inner raw() 401-branch would
     *  call raw('POST', '/auth/refresh', …) again, forever. */
    _isRefreshAttempt = false,
  ): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : API_URL + path);
    const bodyStr = body ? JSON.stringify(body) : '';

    // Compute header signature from canonical form BEFORE signature field is in body.
    // For extension routes, the body already carries its own signature field;
    // the header signature is an additional layer signing the full body as-sent.
    // We strip the signature field for header HMAC so it matches the
    // canonical payload the backend verifies against.
    let headerSignature: string | undefined;
    if (body) {
      const { signature: _, ...payloadForHeader } = body;
      headerSignature = this.signHeaderPayload(payloadForHeader);
    }

    return new Promise<T>((resolve, reject) => {
      if (url.protocol !== 'https:') {
        throw new Error(
          `CLI refuses to send credentials over ${url.protocol}. ` +
          'Set WAITLAYER_API_URL to an https:// endpoint.',
        );
      }
      const transport = https;
      const req = transport.request(
        {
          method,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr).toString(),
            ...(headerSignature
              ? { 'X-WaitLayer-Signature': headerSignature }
              : {}),
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
                // Single retry after refresh. _isRefreshAttempt bounds this to
                // ONE refresh attempt; if /auth/refresh itself returns 401
                // (expired/revoked refresh token) the inner call takes the
                // 401 branch with _isRefreshAttempt=true → reject cleanly
                // instead of recursing.
                try {
                  const refresh = await this.raw<{
                    accessToken: string;
                    refreshToken: string;
                  }>('POST', '/auth/refresh', { refreshToken: this.creds.refreshToken }, true);
                  if (this.creds) {
                    this.creds.accessToken = refresh.accessToken;
                    this.creds.refreshToken = refresh.refreshToken;
                    setCredentials(this.creds);
                  }
                  return this.raw<T>(method, path, body).then(resolve, reject);
                } catch {
                  reject({ status: 401, message: 'unauthorized' });
                }
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

/**
 * Map user-supplied tool names to valid ToolType enum values.
 * Common AI tools → their enum value; unknown → 'terminal' (generic catch-all).
 */
function normalizeToolType(raw: string): string {
  const TOOL_MAP: Record<string, string> = {
    claude_code: 'claude_code',
    'claude-code': 'claude_code',
    codex_cli: 'codex_cli',
    'codex-cli': 'codex_cli',
    codex: 'codex_cli',
    cursor: 'cursor',
    cline: 'cline',
    windsurf: 'windsurf',
    aider: 'aider',
    vscode: 'vscode',
    terminal: 'terminal',
    browser: 'browser',
  };
  const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return TOOL_MAP[key] ?? 'terminal';
}

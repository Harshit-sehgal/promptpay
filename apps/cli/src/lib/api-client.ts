import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { canonicalJson, signPayload } from '@waitlayer/shared';
import { Credentials, getCredentials, setCredentials } from './credentials';

const API_URL = process.env.WAITLAYER_API_URL ?? 'https://api.waitlayer.com/api/v1';
const HMAC_SECRET = process.env.EXTENSION_HMAC_SECRET ?? 'dev-secret-change-me';

export class ApiClient {
  private deviceUUID: string | null = null;

  constructor(private creds: Credentials | null = null) {
    if (!this.creds) this.creds = getCredentials();
    if (this.creds?.deviceUUID) this.deviceUUID = this.creds.deviceUUID;
  }

  async getOrRegisterDevice(): Promise<string> {
    if (this.deviceUUID) return this.deviceUUID;

    const hostname = os.hostname();
    const fingerprint = require('crypto').createHash('sha256').update(`cli-${hostname}`).digest('hex');

    const res = await this.raw<{ id: string }>('POST', '/extension/register-device', {
      toolType: 'vscode',
      fingerprintHash: fingerprint,
      extensionVersion: '0.0.1',
      platform: os.platform() || 'unknown',
    });

    if (res && res.id) {
      this.deviceUUID = res.id;
      if (this.creds) {
        this.creds.deviceUUID = res.id;
        setCredentials(this.creds);
      }
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
    const payload = {
      deviceId: input.deviceId,
      waitStateId: input.waitStateId,
      toolType: input.toolType,
      sessionId: 'cli-' + Date.now(),
      idempotencyKey: 'cli-start-' + input.waitStateId,
    };
    const signature = signPayload(payload, HMAC_SECRET);
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
    const signature = signPayload(payload, HMAC_SECRET);
    return this.raw('POST', '/extension/wait-state/end', {
      ...payload,
      signature,
    });
  }

  private async raw<T>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
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
      headerSignature = signPayload(payloadForHeader, HMAC_SECRET);
    }

    return new Promise<T>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          method,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
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
              } else if (res.statusCode === 401 && this.creds?.refreshToken) {
                // Single retry after refresh
                try {
                  const refresh = await this.raw<{
                    accessToken: string;
                    refreshToken: string;
                  }>('POST', '/auth/refresh', { refreshToken: this.creds.refreshToken });
                  if (this.creds) {
                    this.creds.accessToken = refresh.accessToken;
                    this.creds.refreshToken = refresh.refreshToken;
                    setCredentials(this.creds);
                  }
                  return this.raw<T>(method, path, body).then(resolve, reject);
                } catch (refreshErr: any) {
                  reject({ status: 401, message: 'unauthorized' });
                }
              } else {
                const msg = parsed?.error?.message ?? parsed?.message ?? 'request failed';
                reject({ status: res.statusCode, message: msg, ...parsed });
              }
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          });
        },
      );
      req.on('error', reject);
      if (body) req.write(bodyStr);
      req.end();
    });
  }
}
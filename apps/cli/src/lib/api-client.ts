import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { Credentials, getCredentials, setCredentials } from './credentials';

const API_URL = process.env.WAITLAYER_API_URL ?? 'https://api.waitlayer.com/api/v1';

export class ApiClient {
  constructor(private creds: Credentials | null = null) {
    if (!this.creds) this.creds = getCredentials();
  }

  async login(input: { email: string; password: string }) {
    const res = await this.raw<{
      data: {
        accessToken: string;
        refreshToken: string;
        user: { id: string; role: string };
      };
    }>('POST', '/auth/login', input);
    return res.data;
  }

  async getBalance() {
    const res = await this.raw<{
      data: {
        availableMinor: number;
        pendingMinor: number;
        totalMinor: number;
        paidOutMinor: number;
      };
    }>('GET', '/ledger/balance', undefined);
    return res.data;
  }

  async getOverview() {
    const res = await this.raw<{
      data: {
        impressions: number;
        clicks: number;
        estimatedMinor: number;
      };
    }>('GET', '/developer/dashboard', undefined);
    return res.data;
  }

  async reportWaitState(input: {
    toolType: string;
    durationMs: number;
    deviceFingerprint: string;
  }) {
    return this.raw('POST', '/extension/wait-state/start', {
      ...input,
      sessionId: 'cli-' + Date.now(),
      idempotencyKey: 'cli-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      signature: crypto
        .createHmac('sha256', process.env.WAITLAYER_SECRET ?? 'dev-secret')
        .update(JSON.stringify(input))
        .digest('hex'),
    });
  }

  private async raw<T>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : API_URL + path);
    const bodyStr = body ? JSON.stringify(body) : '';
    const signature = crypto
      .createHmac('sha256', process.env.WAITLAYER_SECRET ?? 'dev-secret')
      .update(bodyStr)
      .digest('hex');

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
            'X-WaitLayer-Signature': signature,
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
                    data: { accessToken: string; refreshToken: string };
                  }>('POST', '/auth/refresh', { refreshToken: this.creds.refreshToken });
                  if (this.creds) {
                    this.creds.accessToken = refresh.data.accessToken;
                    this.creds.refreshToken = refresh.data.refreshToken;
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

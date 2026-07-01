import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ConfigurationManager } from './config';

export interface Ad {
  impressionToken: string;
  campaignId: string;
  headline: string;
  message: string;
  ctaText: string;
  ctaUrl: string;
  // 5-second minimum visible duration is enforced server-side
}

export interface Balance {
  availableMinor: number;
  pendingMinor: number;
  totalMinor: number;
  paidOutMinor: number;
}

interface ServerAdResponse {
  data: Ad | null;
}

interface ServerBalanceResponse {
  data: Balance;
}

export class ApiClient {
  private currentTokens: { accessToken?: string; refreshToken?: string } | null = null;

  constructor(private config: ConfigurationManager) {}

  /** Sign payload with HMAC for outgoing extension events */
  signPayload(body: string): string {
    return crypto
      .createHmac('sha256', this.config.getSecretKey())
      .update(body)
      .digest('hex');
  }

  async waitStateStart(input: {
    deviceId: string;
    waitStateId: string;
    toolType: string;
    idempotencyKey: string;
  }): Promise<void> {
    const payload = {
      deviceId: input.deviceId,
      waitStateId: input.waitStateId,
      toolType: input.toolType,
      timestamp: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey,
    };
    await this.post('/extension/wait-state/start', {
      ...payload,
      signature: this.signPayload(JSON.stringify(payload)),
    });
  }

  async requestAd(input: {
    toolType: string;
    waitDurationMs: number;
    deviceFingerprint: string;
  }): Promise<Ad | null> {
    const res = await this.post<ServerAdResponse>('/extension/ad-request', input);
    return res?.data ?? null;
  }

  async recordImpressionEnd(impressionToken: string, visibleDurationMs: number): Promise<void> {
    await this.post('/extension/impression-qualified', {
      impressionToken,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs,
      idempotencyKey: `imp-${impressionToken}`,
      signature: this.signPayload(JSON.stringify({
        impressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs,
        idempotencyKey: `imp-${impressionToken}`,
      })),
    });
  }

  async recordClick(impressionToken: string): Promise<void> {
    await this.post('/extension/click', {
      impressionToken,
      clickedAt: new Date().toISOString(),
      idempotencyKey: `click-${impressionToken}`,
      signature: this.signPayload(JSON.stringify({
        impressionToken,
        clickedAt: new Date().toISOString(),
        idempotencyKey: `click-${impressionToken}`,
      })),
    });
  }

  async getBalance(): Promise<Balance> {
    const res = await this.get<ServerBalanceResponse>('/ledger/balance');
    return res.data;
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
      const res = await this.post<{ data: { accessToken: string; refreshToken: string } }>(
        '/auth/login',
        { email, password },
      );
      this.currentTokens = res.data;
      vscode.window.showInformationMessage('WaitLayer: logged in');
    } catch {
      vscode.window.showErrorMessage('WaitLayer: login failed');
    }
  }

  async logout(): Promise<void> {
    await this.post('/auth/logout', {});
    this.currentTokens = null;
    vscode.window.showInformationMessage('WaitLayer: logged out');
  }

  // ── HTTP ──

  private url(path: string): string {
    return `${this.config.getApiUrl()}${path}`;
  }

  private async post<T>(path: string, body: any): Promise<T> {
    const bodyStr = JSON.stringify(body);
    const signature = this.signPayload(bodyStr);
    return this.request<T>('POST', path, headers(path, bodyStr, signature), bodyStr);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, { 'Content-Type': 'application/json' }, '');
  }

  private request<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
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
            ...(this.currentTokens?.accessToken
              ? { Authorization: `Bearer ${this.currentTokens.accessToken}` }
              : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = data.length ? JSON.parse(data) : {};
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
    });
  }
}

function headers(path: string, bodyStr: string, signature: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr).toString(),
    'X-WaitLayer-Signature': signature,
    'X-Extension-Version': '0.0.1',
    'X-Tool-Type': 'vscode',
  };
}

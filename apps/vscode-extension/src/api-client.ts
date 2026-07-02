import * as https from 'https';
import * as http from 'http';
import * as vscode from 'vscode';
import { signPayload } from '@waitlayer/shared';
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

  /** Sign payload object with HMAC using canonical JSON (sorted keys). */
  sign(payload: Record<string, unknown>): string {
    return signPayload(payload, this.config.getSecretKey());
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
      signature: this.sign(payload),
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
      signature: this.sign(payload),
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
    const payload = {
      impressionToken,
      qualifiedAt: new Date().toISOString(),
      visibleDurationMs,
      idempotencyKey: `imp-${impressionToken}`,
    };
    await this.post('/extension/impression-qualified', {
      ...payload,
      signature: this.sign(payload),
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
      signature: this.sign(payload),
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

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const bodyStr = JSON.stringify(body);

    // Compute header signature from canonical form WITHOUT the signature field
    let headerSignature: string | undefined;
    if (body) {
      const { signature: _, ...payloadForHeader } = body;
      headerSignature = this.sign(payloadForHeader);
    }

    return this.request<T>(
      'POST',
      path,
      headers(path, bodyStr, headerSignature),
      bodyStr,
    );
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
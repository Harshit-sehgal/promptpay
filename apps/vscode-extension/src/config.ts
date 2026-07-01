import * as vscode from 'vscode';
import * as crypto from 'crypto';

const CONFIG_SECTION = 'waitlayer';

export class ConfigurationManager {
  private deviceKey = 'waitlayer.deviceFingerprint';

  constructor(
    private readonly secrets: vscode.SecretStorage = (globalThis as any).extensionContext
      ?.secrets ?? new DummySecretStorage(),
  ) {}

  getApiUrl(): string {
    return (
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('apiUrl') ||
      'http://localhost:3001'
    );
  }

  getSecretKey(): string {
    return (
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('extensionSecret') ||
      'dev-secret-rotate-in-prod'
    );
  }

  async adsEnabled(): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const stored = cfg.get<boolean>('adsEnabled');
    if (typeof stored === 'boolean') return stored;
    return true;
  }

  async toggleAds(): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const current = await this.adsEnabled();
    await cfg.update('adsEnabled', !current, vscode.ConfigurationTarget.Global);
    return !current;
  }

  async inQuietHours(): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const enabled = cfg.get<boolean>('quietMode.enabled');
    if (!enabled) return false;

    const start = cfg.get<string>('quietMode.start') ?? '22:00';
    const end = cfg.get<string>('quietMode.end') ?? '08:00';
    return isTimeInRange(currentTimeHHMM(), start, end);
  }

  async getMaxAdsPerHour(): Promise<number> {
    return (
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('maxAdsPerHour') ?? 6
    );
  }

  async getDeviceFingerprint(): Promise<string> {
    try {
      const id = await this.secrets.get(this.deviceKey);
      if (id) return id;
    } catch {
      /* fall through to fingerprint fallback */
    }

    // Fallback to stable hash from machine id (non-secret)
    return crypto
      .createHash('sha256')
      .update(`${vscode.env.machineId}-${vscode.env.sessionId}-vscode`)
      .digest('hex');
  }
}

class DummySecretStorage {
  private map = new Map<string, string>();
  async get(k: string): Promise<string | undefined> {
    return Promise.resolve(this.map.get(k));
  }
  async store(k: string, v: string): Promise<void> {
    this.map.set(k, v);
    return Promise.resolve();
  }
  async delete(k: string): Promise<void> {
    this.map.delete(k);
    return Promise.resolve();
  }
}

function currentTimeHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function isTimeInRange(now: string, start: string, end: string): boolean {
  if (start <= end) {
    return now >= start && now <= end;
  }
  // Wraps midnight, e.g. 22:00 → 08:00
  return now >= start || now <= end;
}

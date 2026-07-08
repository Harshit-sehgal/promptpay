import * as vscode from 'vscode';
import * as crypto from 'crypto';

const CONFIG_SECTION = 'waitlayer';

export class ConfigurationManager {
  private readonly secrets: vscode.SecretStorage;
  private deviceKey = 'waitlayer.deviceFingerprint';
  private deviceUuidKey = 'waitlayer.deviceUUID';
  private deviceEventSecretKey = 'waitlayer.deviceEventSecret';

  /**
   * Secrets is required — it carries the VS Code SecretStorage instance from
   * `context.secrets`. There is no globalThis or DummySecretStorage fallback;
   * the DummySecretStorage was removed because it leaks secrets to in-memory
   * storage visible to any extension debugging session. When SecretStorage is
   * not available during unit tests, the test harness must inject its own
   * mock — the ConfigurationManager itself won't paper over the gap.
   */
  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  getApiUrl(): string {
    // Default `localhost:4002` matches the API's API_PORT default (4002) in
    // packages/config.
    return (
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('apiUrl') ||
      'http://localhost:4002/api/v1'
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

  /**
   * How long (ms) the user must be inactive before a wait state is inferred.
   * Default: 15_000 (15 seconds).
   * Configurable via `waitlayer.inactivityTimeoutMs` in VS Code settings.
   */
  getInactivityTimeoutMs(): number {
    return (
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('inactivityTimeoutMs') ?? 15_000
    );
  }

  async getTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const raw = await this.secrets.get('waitlayer.authTokens');
      if (raw) return JSON.parse(raw);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);
      /* tokens not stored yet */
    }
    return null;
  }

  async storeTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
    try {
      await this.secrets.store('waitlayer.authTokens', JSON.stringify(tokens));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);
      /* storage not available */
    }
  }

  async clearTokens(): Promise<void> {
    try {
      await this.secrets.delete('waitlayer.authTokens');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);
      /* storage not available */
    }
  }

  async getDeviceFingerprint(): Promise<string> {
    try {
      const id = await this.secrets.get(this.deviceKey);
      if (id) return id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);
      /* fall through to fingerprint generation */
    }

    // Generate a stable fingerprint from machineId only (no sessionId — it changes per session)
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${vscode.env.machineId}-waitlayer-device`)
      .digest('hex');

    // Persist in SecretStorage so it's stable across restarts
    try {
      await this.secrets.store(this.deviceKey, fingerprint);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);
      /* storage not available — fingerprint regenerated each session */
    }

    return fingerprint;
  }

  async getDeviceUUID(): Promise<string | null> {
    try {
      const id = await this.secrets.get(this.deviceUuidKey);
      if (id) return id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure (getDeviceUUID): ${msg}`);
    }
    return null;
  }

  async storeDeviceUUID(uuid: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceUuidKey, uuid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure (storeDeviceUUID): ${msg}`);
    }
  }

  async getDeviceEventSecret(): Promise<string | null> {
    try {
      const secret = await this.secrets.get(this.deviceEventSecretKey);
      if (secret) return secret;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure (getDeviceEventSecret): ${msg}`);
    }
    return null;
  }

  async storeDeviceEventSecret(secret: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceEventSecretKey, secret);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure (storeDeviceEventSecret): ${msg}`);
    }
  }

  async clearDeviceRegistration(): Promise<void> {
    try {
      await this.secrets.delete(this.deviceUuidKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure (clear UUID): ${msg}`);
    }
    try {
      await this.secrets.delete(this.deviceEventSecretKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure (clear event secret): ${msg}`);
    }
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

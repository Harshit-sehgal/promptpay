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
    // Default `localhost:4000` matches the API's API_PORT default (4000) in
    // packages/config. The earlier `localhost:4002` default drifted from the
    // actual API port and only worked when an explicit override was set.
    return (
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('apiUrl') ||
      'http://localhost:4000/api/v1'
    );
  }

  /**
   * Read the HMAC signing key. Sources, in priority order:
   *
   *  1. `waitlayer.signingKey` from VS Code's secure SecretStorage (set by the
   *     activation hook — never visible to other extensions or to a leaked
   *     settings.json).
   *  2. `waitlayer.extensionSecret` from workspace settings — kept for backward
   *     compatibility with existing installations, but printed with a warning
   *     because plaintext settings are readable by any other extension via
   *     `workspace.getConfiguration()`. Production should migrate to (1).
   *  3. If neither is configured AND we're explicitly in a development
   *     Extension Development Host (`WAITLAYER_DEV_EXTENSION=1` or
   *     `NODE_ENV=development`), use the published dev fallback so
   *     local testing remains friction-free.
   *  4. Otherwise THROW — never silently sign with a known public secret.
   *
   * SecretStorage takes priority because it's the only store not visible to
   * other VS Code extensions through the public workspace API.
   */
  async getSecretKey(): Promise<string> {
    try {
      const stored = await this.secrets.get('waitlayer.signingKey');
      if (stored) return stored;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);
    }

    const configured = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>('extensionSecret');
    if (configured) {
      vscode.window.showWarningMessage(
        'WaitLayer: HMAC signing key is stored in plaintext workspace settings. ' +
          'Migrate it to VS Code SecretStorage for production.',
      );
      return configured;
    }

    const isDevHost =
      process.env.WAITLAYER_DEV_EXTENSION === '1' || process.env.NODE_ENV === 'development';
    if (!isDevHost) {
      vscode.window.showErrorMessage(
        'WaitLayer: waitlayer.signingKey (or waitlayer.extensionSecret) is not configured — ' +
          'events will NOT be signed. Set the VS Code workspace setting to the value configured ' +
          'on the WaitLayer API server.',
      );
      throw new Error('waitlayer.signingKey is required for production extension installs');
    }

    return 'dev-secret-for-local-extension-host-only-never-ship-in-vsix';
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
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);}
    return null;
  }

  async storeDeviceUUID(uuid: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceUuidKey, uuid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);}
  }

  async getDeviceEventSecret(): Promise<string | null> {
    try {
      const secret = await this.secrets.get(this.deviceEventSecretKey);
      if (secret) return secret;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);}
    return null;
  }

  async storeDeviceEventSecret(secret: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceEventSecretKey, secret);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);}
  }

  async clearDeviceRegistration(): Promise<void> {
    try {
      await this.secrets.delete(this.deviceUuidKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);}
    try {
      await this.secrets.delete(this.deviceEventSecretKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[WaitLayer] SecretStorage failure: ${msg}`);}
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

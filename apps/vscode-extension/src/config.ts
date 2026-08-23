import * as crypto from 'crypto';
import * as vscode from 'vscode';

const CONFIG_SECTION = 'ateva';

const DEFAULT_API_URL = 'https://api.ateva.com/api/v1';

export class ConfigurationManager {
  private readonly secrets: vscode.SecretStorage;
  private deviceKey = 'ateva.deviceFingerprint';
  private deviceUuidKey = 'ateva.deviceUUID';
  private deviceEventSecretKey = 'ateva.deviceEventSecret';
  private deviceUserIdKey = 'ateva.deviceUserId';

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

  getEnvironmentKind(): 'development' | 'test' | 'sandbox' | 'staging' | 'production' {
    const value = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>('environmentKind', 'production');
    if (value === 'development' || value === 'test' || value === 'sandbox' || value === 'staging') {
      return value;
    }
    return 'production';
  }

  getApiUrl(): string {
    // Packaged/distributed installs default to the production SaaS origin so a
    // user who installs the extension can reach the real API without manual
    // configuration. Local development overrides via the `ateva.apiUrl`
    // setting (A-013).
    //
    // The override is VALIDATED, not trusted. This extension sends a Ateva
    // access token from SecretStorage to whatever origin this returns, and the
    // setting used to be plain `window` scope — so a repository containing
    // `.vscode/settings.json` with `{"ateva.apiUrl": "https://evil/api/v1"}`
    // repointed it the moment the folder was opened, exfiltrating the access
    // and refresh tokens. `scope: machine` in package.json now stops workspace
    // values being read at all; this check is the second line, because a
    // setting that carries a credential should not be trusted on scope alone.
    const configured = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('apiUrl');
    if (!configured) return DEFAULT_API_URL;

    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      console.error(`[Ateva] Ignoring malformed ateva.apiUrl: ${configured}`);
      return DEFAULT_API_URL;
    }

    // Plain HTTP is allowed only for loopback, where there is no network to
    // intercept. Anything else must be TLS.
    const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
      console.error(
        `[Ateva] Ignoring insecure ateva.apiUrl (${parsed.protocol}//${parsed.host}); ` +
          'only https, or http on loopback, is accepted.',
      );
      return DEFAULT_API_URL;
    }
    return configured;
  }

  /**
   * Web dashboard origin derived from the configured API URL (e.g.
   * `https://api.ateva.com/api/v1` → `https://ateva.com/developer`),
   * so staging/dev installs open the matching dashboard instead of always
   * pointing at the production site.
   */
  getDashboardUrl(): string {
    const apiUrl = this.getApiUrl();
    try {
      const parsed = new URL(apiUrl);
      const host = parsed.hostname;
      const webHost = host.startsWith('api.') ? host.slice('api.'.length) : host;
      return `${parsed.protocol}//${webHost}/developer`;
    } catch {
      return 'https://ateva.vercel.app/developer';
    }
  }

  async adsEnabled(): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const stored = cfg.get<boolean>('adsEnabled');
    if (typeof stored === 'boolean') return stored;
    return false;
  }

  async setAdsEnabled(enabled: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await cfg.update('adsEnabled', enabled, vscode.ConfigurationTarget.Global);
  }

  /** @deprecated Commands use server-authoritative setAdsEnabled(). */
  async toggleAds(): Promise<boolean> {
    const enabled = !(await this.adsEnabled());
    await this.setAdsEnabled(enabled);
    return enabled;
  }

  /**
   * Wait telemetry is intentionally separate from ad display. A user must
   * explicitly opt in before the extension sends any detected wait state,
   * evidence, or ad request to the API.
   */
  async waitTelemetryEnabled(): Promise<boolean> {
    const stored = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>('waitTelemetryEnabled');
    return stored === true;
  }

  async setWaitTelemetryEnabled(enabled: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await cfg.update('waitTelemetryEnabled', enabled, vscode.ConfigurationTarget.Global);
  }

  /** @deprecated Commands use server-authoritative setWaitTelemetryEnabled(). */
  async toggleWaitTelemetry(): Promise<boolean> {
    const enabled = !(await this.waitTelemetryEnabled());
    await this.setWaitTelemetryEnabled(enabled);
    return enabled;
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
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('maxAdsPerHour') ?? 6;
    // Clamp to 0–60: a malformed/negative/huge setting must never make the
    // frequency-cap logic behave pathologically (0 disables ads entirely;
    // >60 would effectively disable the cap).
    if (typeof raw !== 'number' || Number.isNaN(raw)) return 6;
    return Math.max(0, Math.min(60, Math.floor(raw)));
  }

  /**
   * How long (ms) the user must be inactive before a wait state is inferred.
   * Default: 15_000 (15 seconds).
   * Configurable via `ateva.inactivityTimeoutMs` in VS Code settings.
   */
  getInactivityTimeoutMs(): number {
    const raw =
      vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>('inactivityTimeoutMs') ??
      15_000;
    // Clamp to 1s–10min: a 0/negative value would infer waits on every idle
    // keystroke pause, and a huge value would make waits unreachable.
    if (typeof raw !== 'number' || Number.isNaN(raw)) return 15_000;
    return Math.max(1_000, Math.min(600_000, Math.floor(raw)));
  }

  async getTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const raw = await this.secrets.get('ateva.authTokens');
      if (raw) return JSON.parse(raw);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure: ${msg}`);
      /* tokens not stored yet */
    }
    return null;
  }

  async storeTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
    try {
      await this.secrets.store('ateva.authTokens', JSON.stringify(tokens));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure: ${msg}`);
      throw e;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      await this.secrets.delete('ateva.authTokens');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure: ${msg}`);
      throw e;
    }
  }

  async getDeviceFingerprint(): Promise<string> {
    try {
      const id = await this.secrets.get(this.deviceKey);
      if (id) return id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure: ${msg}`);
      /* fall through to fingerprint generation */
    }

    // Generate a stable fingerprint from machineId only (no sessionId — it changes per session)
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${vscode.env.machineId}-ateva-device`)
      .digest('hex');

    // Persist in SecretStorage so it's stable across restarts
    try {
      await this.secrets.store(this.deviceKey, fingerprint);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure: ${msg}`);
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
      console.error(`[Ateva] SecretStorage failure (getDeviceUUID): ${msg}`);
    }
    return null;
  }

  async storeDeviceUUID(uuid: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceUuidKey, uuid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure (storeDeviceUUID): ${msg}`);
    }
  }

  async getDeviceEventSecret(): Promise<string | null> {
    try {
      const secret = await this.secrets.get(this.deviceEventSecretKey);
      if (secret) return secret;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure (getDeviceEventSecret): ${msg}`);
    }
    return null;
  }

  async storeDeviceEventSecret(secret: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceEventSecretKey, secret);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure (storeDeviceEventSecret): ${msg}`);
    }
  }

  async clearDeviceRegistration(): Promise<void> {
    let firstFailure: unknown;
    try {
      await this.secrets.delete(this.deviceUuidKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure (clear UUID): ${msg}`);
      firstFailure = e;
    }
    try {
      await this.secrets.delete(this.deviceEventSecretKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure (clear event secret): ${msg}`);
      firstFailure ??= e;
    }
    try {
      await this.secrets.delete(this.deviceUserIdKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Ateva] SecretStorage failure (clear device userId): ${msg}`);
      firstFailure ??= e;
    }
    if (firstFailure !== undefined) throw firstFailure;
  }

  /** Store the userId associated with the current device registration so
   * a subsequent login can detect an account switch vs a same-user re-auth
   * and avoid bricking same-user re-login behind the support-token wall. */
  async storeDeviceUserId(userId: string): Promise<void> {
    try {
      await this.secrets.store(this.deviceUserIdKey, userId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Ateva] SecretStorage failure (store device userId): ${msg}`);
    }
  }

  async getDeviceUserId(): Promise<string | null> {
    try {
      const id = await this.secrets.get(this.deviceUserIdKey);
      if (id) return id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Ateva] SecretStorage failure (getDeviceUserId): ${msg}`);
    }
    return null;
  }
  /**
   * Preferred display currency for earnings (e.g. 'USD', 'EUR', 'JPY').
   * Empty string (default) ⇒ derived via `primaryCurrency` (first positive
   * balance in ascending ISO-4217 order). P1.4.
   */
  preferredDisplayCurrency(): string {
    const value = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string>('preferredDisplayCurrency');
    return value && value.trim() ? value.trim().toUpperCase() : '';
  }

  /**
   * Staged rollout percentage for detector experiments (P1.17). 0–100.
   * Default 100 ⇒ every enrolled user is in the experiment (behavior
   * unchanged from before the rollout existed). There is no runtime-config
   * client fetch in the extension, so this settings value is the source.
   */
  detectorRolloutPercent(): number {
    const pct = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>('detectorRolloutPercent');
    if (typeof pct !== 'number' || Number.isNaN(pct)) return 100;
    return Math.max(0, Math.min(100, Math.floor(pct)));
  }

  /**
   * Per-detector-source kill switch (P1.17 / P1.18). Returns the set of
   * disabled signal sources (e.g. 'inactivity', 'terminal', 'task'). Default:
   * empty (all sources enabled).
   */
  getDisabledDetectorSources(): string[] {
    const list = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string[]>('disabledDetectorSources');
    return Array.isArray(list) ? list.map((s) => s.toLowerCase()) : [];
  }

  async setDisabledDetectorSources(sources: string[]): Promise<void> {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update('disabledDetectorSources', sources, vscode.ConfigurationTarget.Global);
  }

  /**
   * Toggle a single detector source on/off in `disabledDetectorSources`.
   * Returns the resulting (lower-cased) disabled list.
   */
  async toggleDetectorSource(source: string): Promise<string[]> {
    const normalized = source.toLowerCase();
    const current = this.getDisabledDetectorSources();
    const next = current.includes(normalized)
      ? current.filter((s) => s !== normalized)
      : [...current, normalized];
    await this.setDisabledDetectorSources(next);
    return next;
  }

  /**
   * How long (minutes) NEW waits/ads are suppressed after a successful
   * false-positive report (P1.18). Default 30.
   */
  falsePositiveSuppressionMinutes(): number {
    const mins = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>('falsePositiveSuppressionMinutes');
    if (typeof mins !== 'number' || Number.isNaN(mins)) return 30;
    return Math.max(0, Math.floor(mins));
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

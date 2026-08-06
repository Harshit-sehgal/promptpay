import { createHash } from 'crypto';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';

import {
  AGENT_PROTOCOL_VERSION_HEADER,
  AgentLifecycleEventV1,
  canonicalAgentBatchPayload,
} from '@waitlayer/agent-protocol';
import { DETECTOR_VERSION, DetectorEvidence, signEvidence } from '@waitlayer/shared';

import {
  clearTokens,
  Credentials,
  getDeviceEventSecret,
  getOrCreateInstallationId,
  setCredentials,
  storeDeviceEventSecret,
} from './credentials';
import { parseMinor } from './format';
import { signPayload } from './signing';
import { normalizeToolType } from './tool-types';

// Real CLI version from the packaged manifest instead of a hardcoded
// constant, so device registration always reports the actual shipped build.
// Compiled dist builds resolve the manifest next to the package; dev/test
// imports of the raw source fall back to the declared baseline version.
function readManifestVersion(): string {
  try {
    return (require('../../package.json') as { version: string }).version;
  } catch {
    return '0.0.1';
  }
}
const CLI_MANIFEST_VERSION: string = readManifestVersion();

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

type RawCurrencyTotals = Record<string, number | string>;

function parseCurrencyTotals(
  totals: RawCurrencyTotals | undefined,
): Record<string, bigint> | undefined {
  if (!totals) return undefined;
  return Object.fromEntries(
    Object.entries(totals).map(([currency, amountMinor]) => [currency, parseMinor(amountMinor)]),
  );
}

/**
 * Detect a loopback/localhost API origin. A packaged CLI should point at the
 * production SaaS origin; reaching loopback means the user is either doing
 * local development (via WAITLAYER_API_URL) or has a misconfiguration that
 * will silently fail to reach the real API. Surface it loudly (A-013).
 */
function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

if (isLoopbackUrl(API_URL)) {
  console.warn(
    `[WaitLayer] WARNING: the CLI is pointed at a loopback address (${API_URL}). ` +
      'It will not reach the production WaitLayer API. Set WAITLAYER_API_URL to the ' +
      'production origin (https://api.waitlayer.com/api/v1) unless you are running a local API.',
  );
}

/**
 * Best-effort ISO-3166-1 alpha-2 country code from the host locale (e.g.
 * `en_US.UTF-8` -> `US`). Used for privacy-safe, developer-opt-in country
 * targeting (A-056). Returns undefined when no locale-derived country is
 * available; the server falls back to the profile country.
 *
 * Locales without a country component (`C`, `POSIX`, `C.UTF-8` — common in
 * Docker/CI/dev environments) intentionally return `undefined`. The server
 * uses the profile country as the fallback, so this is not a defect — it's
 * an explicit "no locale-derived country" signal. If a developer running
 * the CLI locally doesn't see country-targeted ads, check `locale` output:
 * `LC_ALL=en_US.UTF-8` or `LANG=en_US.UTF-8` will derive `US`; `LANG=C.UTF-8`
 * will not.
 */
export function detectCountryCode(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? env.LANGUAGE;
  if (!raw) return undefined;
  const match = raw.split(/[.\s]/)[0]?.split('_')[1];
  if (match && /^[A-Za-z]{2}$/.test(match)) return match.toUpperCase();
  // Deliberately undefined — no country code derivable from a C/POSIX locale.
  // This is the correct outcome; the server falls back to profile country.
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

export interface EnvironmentIdentity {
  environmentKind: 'development' | 'test' | 'sandbox' | 'staging' | 'production';
  environmentId: string;
}

export type WaitLaunchMode = 'paused' | 'telemetry_only' | 'earnings_enabled' | 'sandbox';

export interface SandboxCreditsResponse {
  mode: 'sandbox';
  hasCashValue: false;
  currency: 'XTS';
  balanceMinor: string;
  environmentId: string;
}

export interface SandboxPayoutSimulationResponse {
  mode: 'sandbox';
  hasCashValue: false;
  simulationId: string;
  status: string;
  amountMinor: string;
  currency: 'XTS';
  balanceMinor: string;
  providerTxId?: string | null;
  duplicate: boolean;
  environmentId: string;
}

export class ApiClient {
  private deviceUUID: string | null = null;
  private deviceEventSecret: string | null = null;

  constructor(private creds: Credentials | null = null) {
    // Credentials are passed in by the caller (which loads them via the async
    // getCredentials()). The event secret is NOT in the JSON credential file
    // (it's in the OS keychain when available, else a separate obfuscated
    // file); it's loaded lazily on first signing — see signEventPayload().
    if (this.creds?.deviceUUID) this.deviceUUID = this.creds.deviceUUID;
    this.deviceEventSecret = null;
  }

  /** Sign event payloads with the server-issued per-device secret only. */
  private async signEventPayload(payload: Record<string, unknown>): Promise<string> {
    if (!this.deviceEventSecret) {
      this.deviceEventSecret = await getDeviceEventSecret();
    }
    if (!this.deviceEventSecret) {
      throw new Error(
        'WaitLayer device is not registered with an event secret. Run device registration again.',
      );
    }
    return signPayload(payload, this.deviceEventSecret);
  }

  /** Event payloads are signed in-body; no separate header signature is sent. */

  async getOrRegisterDevice(): Promise<string> {
    // Round 36: eagerly load the persisted event secret BEFORE the short-circuit
    // check. On a fresh CLI install the constructor only seeds `deviceUUID`
    // (from creds.deviceUUID); `deviceEventSecret` is loaded lazily in
    // signEventPayload(). If `createWatch` calls getOrRegisterDevice() BEFORE
    // any signEventPayload(), the short-circuit below would see
    // `deviceEventSecret === null` and re-register without `existingEventSecret`
    // — triggering the support-token recovery wall for a same-machine re-register
    // and overwriting the old signing key. Loading here first lets a pre-existing
    // device skip straight to returning its UUID.
    if (this.deviceUUID && !this.deviceEventSecret) {
      try {
        this.deviceEventSecret = await getDeviceEventSecret();
      } catch {
        // No persisted secret yet — proceed to fresh registration below.
      }
    }
    if (this.deviceUUID && this.deviceEventSecret) return this.deviceUUID;

    // New installations use a stable random identity persisted in protected
    // local metadata. The server still receives the historical
    // `fingerprintHash` field for wire compatibility, but it is now only a
    // SHA-256 pseudonym of that random value — never a hash of hostname,
    // username, home path, OS release, architecture, or memory.
    //
    // A device UUID with a missing event secret indicates an older install
    // whose keychain/file secret was lost. Keep the legacy derivation only for
    // that recovery-compatible migration path; no new registration depends on
    // host attributes.
    const hadPersistedInstallationId = Boolean(this.creds?.installationId);
    const installationId = await getOrCreateInstallationId();
    if (this.creds) this.creds.installationId = installationId;
    const legacySecretRecovery =
      Boolean(this.deviceUUID) && !this.deviceEventSecret && !hadPersistedInstallationId;
    const fingerprint = legacySecretRecovery
      ? createLegacyFingerprint()
      : createHash('sha256').update(`waitlayer-installation:${installationId}`).digest('hex');
    const recoverySupportToken = process.env.WAITLAYER_DEVICE_RECOVERY_TOKEN?.trim();
    const registrationPayload = {
      toolType: 'terminal',
      // Keep fingerprintHash for legacy server/client compatibility while the
      // server derives the authoritative keyed pseudonym from installationId.
      fingerprintHash: fingerprint,
      ...(legacySecretRecovery ? {} : { installationId }),
      extensionVersion: CLI_MANIFEST_VERSION,
      platform: os.platform() || 'unknown',
      ...(this.deviceEventSecret ? { existingEventSecret: this.deviceEventSecret } : {}),
      ...(recoverySupportToken ? { recoverySupportToken } : {}),
    };

    let res: RegisterDeviceResponse;
    try {
      res = await this.raw<RegisterDeviceResponse>(
        'POST',
        '/extension/register-device',
        registrationPayload,
      );
    } catch (err: unknown) {
      // During a rolling deployment, an older API may still reject the new
      // installationId field because its strict ValidationPipe forbids unknown
      // properties. The fingerprintHash is already derived from the random
      // installation ID, so retrying without only this additive field keeps
      // old servers compatible without weakening their validation rules.
      if (installationId && isUnknownInstallationIdError(err)) {
        const { installationId: _unsupported, ...legacyPayload } = registrationPayload;
        res = await this.raw<RegisterDeviceResponse>(
          'POST',
          '/extension/register-device',
          legacyPayload,
        );
      } else {
        if (isDeviceRecoveryError(err) && !recoverySupportToken) {
          throw new Error(
            `${getRequestErrorMessage(err)}. ` +
              'If support issued a device recovery token, rerun with WAITLAYER_DEVICE_RECOVERY_TOKEN set to that one-time token.',
          );
        }
        throw err;
      }
    }

    if (res && res.id) {
      if (!res.eventSecret) {
        throw new Error('Device registration did not return an event secret');
      }
      this.deviceUUID = res.id;
      this.deviceEventSecret = res.eventSecret;
      if (this.creds) {
        this.creds.deviceUUID = res.id;
        await setCredentials(this.creds);
      }
      // Persist the event secret separately (not in the main credential JSON).
      await storeDeviceEventSecret(res.eventSecret);
      return res.id;
    }
    throw new Error('Failed to register CLI device');
  }

  async ingestAgentEvents(input: {
    installationId: string;
    deviceId: string;
    events: AgentLifecycleEventV1[];
  }): Promise<{
    accepted: string[];
    duplicates: string[];
    rejected: Array<{ eventId: string; reason: string }>;
  }> {
    const payload = {
      schemaVersion: 1 as const,
      environmentId: process.env.WAITLAYER_ENVIRONMENT_ID ?? 'local',
      installationId: input.installationId,
      deviceId: input.deviceId,
      events: input.events,
    };
    const signature = await this.signEventPayload(canonicalAgentBatchPayload(payload));
    return this.raw('POST', '/agent-events/batch', { ...payload, signature });
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
    // Monetary BigInt values are serialized as strings; retain them as bigint
    // so status output stays exact above Number.MAX_SAFE_INTEGER.
    const res = await this.raw<{
      available: { amountMinor: number | string; currency: string; byCurrency?: RawCurrencyTotals };
      pending: { amountMinor: number | string; currency: string; byCurrency?: RawCurrencyTotals };
      total: { amountMinor: number | string; currency: string; byCurrency?: RawCurrencyTotals };
      paidOut: { amountMinor: number | string; currency: string; byCurrency?: RawCurrencyTotals };
    }>('GET', '/ledger/balance', undefined);
    return {
      available: {
        amountMinor: parseMinor(res.available.amountMinor),
        currency: res.available.currency,
        byCurrency: parseCurrencyTotals(res.available.byCurrency),
      },
      pending: {
        amountMinor: parseMinor(res.pending.amountMinor),
        currency: res.pending.currency,
        byCurrency: parseCurrencyTotals(res.pending.byCurrency),
      },
      total: {
        amountMinor: parseMinor(res.total.amountMinor),
        currency: res.total.currency,
        byCurrency: parseCurrencyTotals(res.total.byCurrency),
      },
      paidOut: {
        amountMinor: parseMinor(res.paidOut.amountMinor),
        currency: res.paidOut.currency,
        byCurrency: parseCurrencyTotals(res.paidOut.byCurrency),
      },
    };
  }

  async getEnvironmentIdentity(): Promise<EnvironmentIdentity> {
    return this.raw<EnvironmentIdentity>('GET', '/health', undefined);
  }

  async getSandboxCredits(): Promise<SandboxCreditsResponse> {
    return this.raw<SandboxCreditsResponse>('GET', '/sandbox/credits', undefined);
  }

  async claimSandboxFaucet(
    idempotencyKey: string,
  ): Promise<
    SandboxCreditsResponse & { grantedMinor: number; duplicate: boolean; exhausted: boolean }
  > {
    return this.raw('POST', '/sandbox/faucet', { idempotencyKey });
  }

  async simulateSandboxPayout(input: {
    amountMinor: number;
    destinationAlias: string;
    outcome: 'paid' | 'processing' | 'failed' | 'ambiguous' | 'reversed';
    idempotencyKey: string;
  }): Promise<SandboxPayoutSimulationResponse> {
    return this.raw<SandboxPayoutSimulationResponse>('POST', '/sandbox/payouts', input);
  }

  async listSandboxPayouts(): Promise<{
    mode: 'sandbox';
    hasCashValue: false;
    payouts: Array<Record<string, unknown>>;
  }> {
    return this.raw('GET', '/sandbox/payouts', undefined);
  }

  async getRequiredConsentVersions(): Promise<Record<string, string> | null> {
    return this.raw<Record<string, string>>('GET', '/consent/required-versions');
  }

  async getOverview() {
    // Backend returns full dashboard: { estimatedEarnings, confirmedEarnings, pendingEarnings, heldEarnings, availableForPayout, lifetimeEarnings, trustLevel, trustScore, settings }
    // Monetary BigInt values are serialized as strings; retain them as bigint
    // so status output stays exact above Number.MAX_SAFE_INTEGER.
    const res = await this.raw<{
      estimatedEarnings: number | string;
      confirmedEarnings: number | string;
      pendingEarnings: number | string;
      heldEarnings: number | string;
      availableForPayoutMinor: number | string;
      recoveryDebtMinor: number | string;
      lifetimeEarnings: number | string;
      estimatedEarningsByCurrency?: RawCurrencyTotals;
      confirmedEarningsByCurrency?: RawCurrencyTotals;
      pendingEarningsByCurrency?: RawCurrencyTotals;
      heldEarningsByCurrency?: RawCurrencyTotals;
      availableForPayoutByCurrency?: RawCurrencyTotals;
      lifetimeEarningsByCurrency?: RawCurrencyTotals;
      trustLevel: string;
      trustScore?: number;
    }>('GET', '/developer/dashboard', undefined);
    return {
      estimatedEarnings: parseMinor(res.estimatedEarnings),
      confirmedEarnings: parseMinor(res.confirmedEarnings),
      pendingEarnings: parseMinor(res.pendingEarnings),
      heldEarnings: parseMinor(res.heldEarnings),
      availableForPayout: parseMinor(res.availableForPayoutMinor),
      recoveryDebt: parseMinor(res.recoveryDebtMinor ?? '0'),
      lifetimeEarnings: parseMinor(res.lifetimeEarnings),
      estimatedEarningsByCurrency: parseCurrencyTotals(res.estimatedEarningsByCurrency),
      confirmedEarningsByCurrency: parseCurrencyTotals(res.confirmedEarningsByCurrency),
      pendingEarningsByCurrency: parseCurrencyTotals(res.pendingEarningsByCurrency),
      heldEarningsByCurrency: parseCurrencyTotals(res.heldEarningsByCurrency),
      availableForPayoutByCurrency: parseCurrencyTotals(res.availableForPayoutByCurrency),
      lifetimeEarningsByCurrency: parseCurrencyTotals(res.lifetimeEarningsByCurrency),
      trustLevel: res.trustLevel,
      trustScore: res.trustScore,
    };
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

  /** Revoke the current session server-side via POST /auth/logout. The
   * call may fail if the access token has already expired — the caller
   * (runLogout) swallows errors and proceeds with local cleanup so the
   * user's secrets are always wiped regardless of server state. */
  async logout(): Promise<void> {
    return this.raw('POST', '/auth/logout', {});
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

  async createWaitAttestationSession(input: {
    deviceId: string;
    waitStateId: string;
    sessionId: string;
    provider: string;
  }) {
    return this.raw<{
      attestationSessionId: string;
      nonce: string;
      operationStartDeadline: string;
      consumeDeadline: string;
    }>('POST', '/extension/wait-attestation/session', input);
  }

  async consumeWaitAttestation(input: { attestationSessionId: string; assertion: string }) {
    return this.raw('POST', '/extension/wait-attestation/consume', input);
  }

  async reportWaitState(input: {
    deviceId: string;
    waitStateId: string;
    toolType: string;
    sessionId: string;
    evidence?: Omit<
      DetectorEvidence,
      'signature' | 'detectorVersion' | 'waitStateId' | 'sessionId'
    >[];
  }) {
    // Normalize tool name to a valid ToolType enum value.
    // Common tool names map to enum values; unrecognized ones default to 'terminal'.
    const normalizedTool = normalizeToolType(input.toolType);

    // Sign any detector evidence with the per-device secret before sending.
    // Evidence items without a valid signature are rejected by the API, so the
    // client must produce them locally using the device secret.
    const secret = this.deviceEventSecret ?? (await getDeviceEventSecret());
    const evidence: DetectorEvidence[] = [];
    if (secret && input.evidence) {
      for (const item of input.evidence) {
        const signedItem: Omit<DetectorEvidence, 'signature'> = {
          ...item,
          detectorVersion: DETECTOR_VERSION,
          waitStateId: input.waitStateId,
          sessionId: input.sessionId,
        };
        evidence.push({
          ...signedItem,
          signature: signEvidence(signedItem, secret),
        });
      }
    }

    const payload = {
      deviceId: input.deviceId,
      waitStateId: input.waitStateId,
      toolType: normalizedTool,
      sessionId: input.sessionId,
      idempotencyKey: 'cli-start-' + input.waitStateId,
      ...(evidence.length > 0 ? { evidence } : {}),
    };
    const signature = await this.signEventPayload(payload);
    return this.raw('POST', '/extension/wait-state/start', {
      ...payload,
      signature,
    });
  }

  async endWaitState(input: { waitStateId: string; durationSeconds: number }) {
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
  }): Promise<{ ad: Ad | null; mode?: WaitLaunchMode; hasCashValue?: boolean }> {
    // A-056: send a best-effort ISO country code so country-targeted campaigns
    // can be enforced without server-side geolocation. Falls back to the
    // developer's profile country server-side when omitted.
    const country = input.country ?? detectCountryCode();
    // Normalize the tool name to a valid ToolType enum value, exactly as
    // reportWaitState() does. Without this, the two correlated endpoints for
    // a single wait state receive different toolType values (wait-state/start
    // gets the normalized enum, ad-request gets the raw user string), and an
    // @IsEnum(ToolType) validator on the ad-request DTO would silently reject
    // the ad for any non-canonical tool name — breaking the money loop.
    const normalizedTool = normalizeToolType(input.toolType);
    const payload = {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      waitStateId: input.waitStateId,
      toolType: normalizedTool,
      idempotencyKey: input.idempotencyKey,
      ...(country ? { country } : {}),
    };
    const signature = await this.signEventPayload(payload);
    const res = await this.raw<{
      ad: Ad | null;
      mode?: WaitLaunchMode;
      hasCashValue?: boolean;
    }>('POST', '/extension/ad-request', {
      ...payload,
      signature,
    });
    return { ad: res?.ad ?? null, mode: res?.mode, hasCashValue: res?.hasCashValue };
  }

  async requestSandboxCompletionPlacement(input: {
    deviceId: string;
    correlationId: string;
    idempotencyKey: string;
    country?: string;
  }): Promise<{ ad: Ad | null; mode?: WaitLaunchMode; hasCashValue?: boolean; reason?: string }> {
    const country = input.country ?? detectCountryCode();
    const payload = {
      deviceId: input.deviceId,
      correlationId: input.correlationId,
      placementType: 'completion_return' as const,
      idempotencyKey: input.idempotencyKey,
      ...(country ? { country } : {}),
    };
    const signature = await this.signEventPayload(payload);
    const res = await this.raw<{
      ad: Ad | null;
      mode?: WaitLaunchMode;
      hasCashValue?: boolean;
      reason?: string;
    }>('POST', '/extension/sandbox-placement-request', { ...payload, signature });
    return {
      ad: res?.ad ?? null,
      mode: res?.mode,
      hasCashValue: res?.hasCashValue,
      reason: res?.reason,
    };
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
  private _refreshInProgress: Promise<{ accessToken: string; refreshToken: string } | null> | null =
    null;

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
        await setCredentials(this.creds);
      }
      return refresh;
    } catch {
      // The refresh token is dead (family revoked, session revoked server-side,
      // or rotated by another client). Clear persisted tokens so the next CLI
      // command surfaces a clean "not logged in" state instead of looping on
      // 401→refresh-with-dead-token→401 forever. Mirrors the VSCode client
      // (which clears currentTokens + calls clearTokens() on refresh failure).
      if (this.creds) {
        this.creds.accessToken = '';
        this.creds.refreshToken = '';
      }
      try {
        await clearTokens();
      } catch {
        // Best-effort — local file/keychain clear failure must not mask the
        // original refresh failure. The in-memory wipe above already prevents
        // further retry loops this process.
      }
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
    // Network-resilient retry (gap #31): transient failures — socket errors,
    // timeouts, 429/5xx — are retried with capped exponential backoff.
    // Application 4xx (except 429) are not retried to avoid double-writes.
    // Refresh attempts are exempt from transient-retry: the server rotates the
    // token family on the first successful refresh (CAS revoke of the old jti).
    // If that ACK is lost to a transient error and the client resends the
    // same pre-rotation refresh token, the server detects reuse (the jti is
    // already revoked → count===0) and revokes the entire family, force-logging
    // the user out everywhere. A failed refresh is terminal — clear tokens and
    // let the user re-authenticate; do not re-send a consumed refresh token.
    const MAX_ATTEMPTS = _isRefreshAttempt ? 1 : 3;
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        return await this.attemptRaw<T>(method, path, body, _isRefreshAttempt);
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || !this.isRetryableError(err)) throw err;
        const backoffMs = Math.min(500 * 2 ** (attempt - 1), 8000);
        await this.sleep(backoffMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }

  private isRetryableError(err: unknown): boolean {
    if (!isRecord(err)) return false;
    const status = typeof err.status === 'number' ? err.status : undefined;
    if (status !== undefined && (status === 429 || status >= 500)) return true;
    const code = typeof err.code === 'string' ? err.code : undefined;
    if (
      code &&
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNABORTED',
      ].includes(code)
    ) {
      return true;
    }
    const message = typeof err.message === 'string' ? err.message : undefined;
    if (message && message.toLowerCase().includes('timed out')) return true;
    return false;
  }

  private attemptRaw<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Record<string, unknown> | undefined,
    _isRefreshAttempt = false,
  ): Promise<T> {
    const isAbsoluteUrl = /^[a-z][a-z\d+\-.]*:\/\//i.test(path);
    const url = new URL(isAbsoluteUrl ? path : API_URL + path);
    const bodyStr = body ? JSON.stringify(body) : '';

    const { promise, resolve, reject } = Promise.withResolvers<T>();

    // No header signature: the body already carries `signature`, and the API
    // does not verify an X-WaitLayer-Signature header. Emitting one would
    // leak the per-device HMAC signing key to anyone reading headers
    // (proxies, browser DevTools, server access logs that capture headers).
    const requestHostname =
      url.hostname.startsWith('[') && url.hostname.endsWith(']')
        ? url.hostname.slice(1, -1)
        : url.hostname;
    const isLoopback =
      requestHostname === 'localhost' ||
      requestHostname === '127.0.0.1' ||
      requestHostname === '::1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
      reject(
        new Error(
          `CLI refuses to send credentials over ${url.protocol}. ` +
            'Set WAITLAYER_API_URL to an https:// endpoint, or http://localhost for local development.',
        ),
      );
      return promise;
    }
    const transport = url.protocol === 'https:' ? https : http;
    // DNS resolution timeout: req.setTimeout covers established-connection
    // wall clock but NOT the DNS lookup phase. A hung resolver (misconfigured
    // /etc/resolv.conf, unreachable DNS server, captive portal) would block
    // every CLI API call indefinitely. Bound the lookup explicitly so a dead
    // resolver fails fast instead of hanging the user's terminal. The 5s
    // budget is shared with connection setup under the 30s req.setTimeout
    // ceiling above.
    const lookupWithTimeout = (
      hostname: string,
      _options: dns.LookupOptions,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string | dns.LookupAddress[],
        family?: number,
      ) => void,
    ) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const err: NodeJS.ErrnoException = new Error(`DNS resolution timed out for ${hostname}`);
        err.code = 'DNSLOOKUP_TIMEOUT';
        cb(err, '', 4);
      }, 5_000);
      dns.lookup(hostname, _options, (err, address, family) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          cb(err, '', 4);
          return;
        }
        // Node's lookup contract: the caller selects the result shape via the
        // `all` option. `dns.lookup` already returns an array when `all: true`
        // and a string otherwise, so forward it unchanged. The prior code
        // collapsed the array to `address[0]?.address` and dropped `family`,
        // which fed `onlookupall` a single string and threw
        // "Invalid IP address: undefined" against a live host.
        if (typeof address === 'string') {
          cb(null, address, family);
        } else {
          cb(null, address);
        }
      });
    };
    const req = transport.request(
      {
        method,
        hostname: requestHostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        lookup: lookupWithTimeout,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr).toString(),
          ...(url.pathname === '/agent-events/batch'
            ? { [AGENT_PROTOCOL_VERSION_HEADER]: '1' }
            : {}),
          ...(this.creds?.accessToken ? { Authorization: `Bearer ${this.creds.accessToken}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
          let parsed: unknown;
          try {
            parsed = data.length ? JSON.parse(data) : {};
          } catch {
            // The response body is not valid JSON (e.g. a proxy/load-balancer
            // HTML error page). We can't extract a structured error message,
            // but the status code is still the authoritative signal — if this
            // is a 401 we should attempt token refresh, and if not we reject
            // with a clear description instead of the generic "Invalid JSON
            // response" which hides the real cause from the user.
            if (res.statusCode === 401 && this.creds?.refreshToken && !_isRefreshAttempt) {
              const newTokens = await this.refreshTokens();
              if (newTokens) {
                try {
                  resolve(await this.attemptRaw<T>(method, path, body, true));
                } catch (retryErr) {
                  reject(retryErr);
                }
                return;
              }
              reject({ status: 401, message: 'unauthorized' });
              return;
            }
            reject(
              new Error(
                `Server returned ${res.statusCode} with a non-JSON body` +
                  (data.length ? ` (first 100 chars: ${data.slice(0, 100)})` : ''),
              ),
            );
            return;
          }
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed as T);
              return;
            }
            if (res.statusCode === 401 && this.creds?.refreshToken && !_isRefreshAttempt) {
              const newTokens = await this.refreshTokens();
              if (newTokens) {
                try {
                  resolve(await this.attemptRaw<T>(method, path, body, true));
                } catch (retryErr) {
                  reject(retryErr);
                }
                return;
              }
              reject({ status: 401, message: 'unauthorized' });
              return;
            }
            const parsedObject = isRecord(parsed) ? parsed : {};
            const msg =
              typeof parsedObject.message === 'string' ? parsedObject.message : 'request failed';
            reject({ status: res.statusCode, message: msg, ...parsedObject });
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
    return promise;
  }
}

function createLegacyFingerprint(): string {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const homedir = os.homedir();
  const platform = os.platform();
  const arch = os.arch();
  const ostype = os.type();
  const osrelease = os.release();
  const totalMemGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  return createHash('sha256')
    .update(
      `cli-${hostname}-${username}-${platform}-${arch}-${homedir}-${ostype}-${osrelease}-${totalMemGb}`,
    )
    .digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRequestErrorMessage(err: unknown): string {
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function isUnknownInstallationIdError(err: unknown): boolean {
  if (!isRecord(err) || err.status !== 400) return false;
  const message = err.message;
  const text = Array.isArray(message) ? message.join(' ') : String(message ?? '');
  return /installationId/i.test(text) && /not exist|unknown|whitelist/i.test(text);
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

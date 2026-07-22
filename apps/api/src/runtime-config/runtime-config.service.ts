import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';

export interface RuntimeConfigKey {
  scope: string;
  target: string;
}

/**
 * User-visible operating state for the wait/rewards loop.  This deliberately
 * describes what a developer can receive *now*, rather than what an operator
 * may intend to enable later.
 */
export type WaitLaunchMode = 'paused' | 'ads_only' | 'earnings_enabled';

export const RUNTIME_CONFIG_KEYS = {
  ADS_GLOBAL: { scope: 'ads', target: 'global' },
  // Client-side wait evidence is not an independent attestation. Keep the
  // money path closed until an operator deliberately enables it after an
  // independently verifiable detector integration is in place.
  WAIT_EARNINGS: { scope: 'wait', target: 'earnings' },
  DEPOSITS_GLOBAL: { scope: 'deposits', target: 'global' },
  PAYOUT_REQUESTS: { scope: 'payouts', target: 'requests' },
  PAYOUT_AUTO: { scope: 'payouts', target: 'auto' },
  BLOCKED_PAYOUT_PROVIDERS: { scope: 'payouts', target: 'providers.blocked' },
  BLOCKED_TOOLS: { scope: 'tools', target: 'blocked' },
  BLOCKED_COUNTRIES: { scope: 'countries', target: 'blocked' },
  BLOCKED_CURRENCIES: { scope: 'currencies', target: 'blocked' },
  BLOCKED_EXTENSION_VERSIONS: { scope: 'extension', target: 'versions.blocked' },
  EXTENSION_MIN_VERSION: { scope: 'extension', target: 'min_version' },
  DETECTOR_VERSION: { scope: 'detector', target: '1.0.0' },
} as const satisfies Record<string, RuntimeConfigKey>;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class RuntimeConfigService {
  private readonly ttlMs = 30_000;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  private cacheKey(scope: string, target: string): string {
    return `${scope}:${target}`;
  }

  private getCached<T>(scope: string, target: string): T | undefined {
    const key = this.cacheKey(scope, target);
    const entry = this.cache.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.value as T;
    this.cache.delete(key);
    return undefined;
  }

  private setCached<T>(scope: string, target: string, value: T): void {
    const key = this.cacheKey(scope, target);
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  private invalidate(scope: string, target: string): void {
    this.cache.delete(this.cacheKey(scope, target));
  }

  // ── Generic primitives ──

  async getBoolean(key: RuntimeConfigKey, defaultValue = true): Promise<boolean> {
    const cached = this.getCached<boolean>(key.scope, key.target);
    if (cached !== undefined) return cached;

    const row = await this.prisma.systemSetting.findUnique({
      where: { scope_target: { scope: key.scope, target: key.target } },
    });
    const value = this.extractBoolean(row?.value, defaultValue);
    this.setCached(key.scope, key.target, value);
    return value;
  }

  async setBoolean(
    key: RuntimeConfigKey,
    enabled: boolean,
    actorId: string,
    reason?: string,
  ): Promise<Prisma.SystemSettingGetPayload<{}>> {
    const upserted = await this.prisma.systemSetting.upsert({
      where: { scope_target: { scope: key.scope, target: key.target } },
      create: { scope: key.scope, target: key.target, value: { enabled } },
      update: { value: { enabled }, reason },
    });
    this.setCached(key.scope, key.target, enabled);
    await this.audit.log({
      actorId,
      actorRole: 'admin',
      action: 'update_system_setting',
      targetType: 'system_setting',
      targetId: `${key.scope}.${key.target}`,
      afterSnap: { enabled, reason },
    });
    return upserted;
  }

  async getStringArray(key: RuntimeConfigKey, defaultValue: string[] = []): Promise<string[]> {
    const cached = this.getCached<string[]>(key.scope, key.target);
    if (cached !== undefined) return cached;

    const row = await this.prisma.systemSetting.findUnique({
      where: { scope_target: { scope: key.scope, target: key.target } },
    });
    const value = this.extractStringArray(row?.value, defaultValue);
    this.setCached(key.scope, key.target, value);
    return value;
  }

  async setStringArray(
    key: RuntimeConfigKey,
    values: string[],
    actorId: string,
    reason?: string,
  ): Promise<Prisma.SystemSettingGetPayload<{}>> {
    const upserted = await this.prisma.systemSetting.upsert({
      where: { scope_target: { scope: key.scope, target: key.target } },
      create: { scope: key.scope, target: key.target, value: { values } },
      update: { value: { values }, reason },
    });
    this.setCached(key.scope, key.target, values);
    await this.audit.log({
      actorId,
      actorRole: 'admin',
      action: 'update_system_setting',
      targetType: 'system_setting',
      targetId: `${key.scope}.${key.target}`,
      afterSnap: { values, reason },
    });
    return upserted;
  }

  async getString(
    key: RuntimeConfigKey,
    defaultValue: string | null = null,
  ): Promise<string | null> {
    const cached = this.getCached<string | null>(key.scope, key.target);
    if (cached !== undefined) return cached;

    const row = await this.prisma.systemSetting.findUnique({
      where: { scope_target: { scope: key.scope, target: key.target } },
    });
    const value = this.extractString(row?.value, defaultValue);
    this.setCached(key.scope, key.target, value);
    return value;
  }

  async setString(
    key: RuntimeConfigKey,
    value: string,
    actorId: string,
    reason?: string,
  ): Promise<Prisma.SystemSettingGetPayload<{}>> {
    const upserted = await this.prisma.systemSetting.upsert({
      where: { scope_target: { scope: key.scope, target: key.target } },
      create: { scope: key.scope, target: key.target, value: { value } },
      update: { value: { value }, reason },
    });
    this.setCached(key.scope, key.target, value);
    await this.audit.log({
      actorId,
      actorRole: 'admin',
      action: 'update_system_setting',
      targetType: 'system_setting',
      targetId: `${key.scope}.${key.target}`,
      afterSnap: { value, reason },
    });
    return upserted;
  }

  async getAll(): Promise<Prisma.SystemSettingGetPayload<{}>[]> {
    return this.prisma.systemSetting.findMany({ orderBy: [{ scope: 'asc' }, { target: 'asc' }] });
  }

  /**
   * Set an arbitrary JSON value for a scope/target pair. Used by the admin
   * endpoint for blocklists and future structured switches. The caller is
   * responsible for validating the payload shape.
   */
  async setRaw(
    scope: string,
    target: string,
    rawValue: string,
    actorId: string,
    reason?: string,
  ): Promise<Prisma.SystemSettingGetPayload<{}>> {
    let value: Prisma.InputJsonValue;
    try {
      value = JSON.parse(rawValue) as Prisma.InputJsonValue;
    } catch {
      throw new Error('Value must be valid JSON');
    }
    const upserted = await this.prisma.systemSetting.upsert({
      where: { scope_target: { scope, target } },
      create: { scope, target, value },
      update: { value, reason: reason ?? null },
    });
    this.invalidate(scope, target);
    await this.audit.log({
      actorId,
      actorRole: 'admin',
      action: 'update_system_setting',
      targetType: 'system_setting',
      targetId: `${scope}.${target}`,
      afterSnap: { value, reason },
    });
    return upserted;
  }

  // ── Convenience helpers ──

  async isAdsEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, true);
  }

  /**
   * Whether client wait events may settle real-money CPM/CPC earnings.
   *
   * This is intentionally fail-closed. Device HMACs prove possession of a
   * client-held secret, not that a real developer-tool wait occurred, so a
   * fresh deployment must not debit advertisers or credit developers until
   * the operator has reviewed and enabled an independent attestation path.
   */
  async isWaitEarningsEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.WAIT_EARNINGS, false);
  }

  /**
   * Resolve the externally observable wait-loop mode from the two independent
   * safety switches.  Ads are never represented as rewards while settlement is
   * closed: callers can use this to suppress a misleading ad surface.
   */
  async getWaitLaunchMode(): Promise<WaitLaunchMode> {
    const [adsEnabled, earningsEnabled] = await Promise.all([
      this.isAdsEnabled(),
      this.isWaitEarningsEnabled(),
    ]);
    if (!adsEnabled) return 'paused';
    return earningsEnabled ? 'earnings_enabled' : 'ads_only';
  }

  async isDepositsEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.DEPOSITS_GLOBAL, true);
  }

  async isPayoutRequestsEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.PAYOUT_REQUESTS, true);
  }

  async isAutoPayoutProcessingEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.PAYOUT_AUTO, true);
  }

  async isProviderEnabled(provider: string): Promise<boolean> {
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_PAYOUT_PROVIDERS, []);
    return !blocked.includes(provider);
  }

  async isToolEnabled(slug: string): Promise<boolean> {
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_TOOLS, []);
    return !blocked.includes(slug);
  }

  async isCountryAllowed(country: string | null | undefined): Promise<boolean> {
    if (!country) return true;
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_COUNTRIES, []);
    return !blocked.includes(country.toUpperCase());
  }

  async isCurrencyAllowed(currency: string | null | undefined): Promise<boolean> {
    if (!currency) return true;
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_CURRENCIES, []);
    return !blocked.includes(currency.toUpperCase());
  }

  async isExtensionVersionAllowed(version: string | null | undefined): Promise<boolean> {
    if (!version) return true;
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_EXTENSION_VERSIONS, []);
    if (blocked.includes(version)) return false;
    const minVersion = await this.getString(RUNTIME_CONFIG_KEYS.EXTENSION_MIN_VERSION, null);
    if (!minVersion) return true;
    return this.compareVersions(version, minVersion) >= 0;
  }

  /**
   * Detector-version kill-switch (P1.17). Operators disable a specific wait
   * detector release via `POST /admin/settings/detector/<version>/toggle`
   * (`{enabled:false}`); the value is stored as `{ enabled: boolean }` under
   * the `detector` scope. Defaults to `true` when no config row exists so an
   * unconfigured version stays enabled (existing behavior unchanged). A null
   * or missing version is treated as enabled because it cannot be attributed
   * to a specific disabled release.
   */
  async isDetectorVersionEnabled(detectorVersion: string | null | undefined): Promise<boolean> {
    if (!detectorVersion) return true;
    return this.getBoolean(
      { scope: RUNTIME_CONFIG_KEYS.DETECTOR_VERSION.scope, target: detectorVersion },
      true,
    );
  }

  /**
   * Returns the raw comma-separated detector-version allowlist. The allowlist
   * is read from the validated application config (fail-closed default is an
   * empty string, which means no sources are treated as verified). Consumers
   * should pass this string to `isVerifiedDetectorSource()`.
   */
  getVerifiedDetectorVersions(): string {
    return (this.config.get<string>('VERIFIED_DETECTOR_VERSIONS') ?? '').trim();
  }

  // ── Private helpers ──

  private extractBoolean(value: unknown, defaultValue: boolean): boolean {
    if (value && typeof value === 'object' && 'enabled' in value) {
      return Boolean((value as { enabled: unknown }).enabled);
    }
    return defaultValue;
  }

  private extractStringArray(value: unknown, defaultValue: string[]): string[] {
    if (value && typeof value === 'object' && 'values' in value) {
      const values = (value as { values: unknown }).values;
      if (Array.isArray(values)) {
        return values.filter((v): v is string => typeof v === 'string');
      }
    }
    return defaultValue;
  }

  private extractString(value: unknown, defaultValue: string | null): string | null {
    if (value && typeof value === 'object' && 'value' in value) {
      const v = (value as { value: unknown }).value;
      if (typeof v === 'string') return v;
    }
    return defaultValue;
  }

  private compareVersions(a: string, b: string): number {
    const parse = (v: string) =>
      v
        .split('.')
        .map((part) => parseInt(part.replace(/[^\d].*$/, ''), 10))
        .filter((n) => !Number.isNaN(n));
    const aParts = parse(a);
    const bParts = parse(b);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const av = aParts[i] ?? 0;
      const bv = bParts[i] ?? 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }
}

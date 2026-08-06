import { createClient, RedisClientType } from 'redis';
import semver from 'semver';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
export type WaitLaunchMode = 'paused' | 'telemetry_only' | 'earnings_enabled';

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

const RUNTIME_CONFIG_INVALIDATION_CHANNEL = 'waitlayer:runtime-config:invalidate';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function parseCodeAllowlist(value: string | undefined, pattern: RegExp): Set<string> | null {
  if (!value?.trim()) return null;
  const entries = value
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return entries.every((entry) => pattern.test(entry)) ? new Set(entries) : new Set();
}

@Injectable()
export class RuntimeConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly ttlMs = 30_000;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly logger = new Logger(RuntimeConfigService.name);
  private readonly redisUrl: string | undefined;
  private readonly redisConnectTimeoutMs: number | undefined;
  private readonly allowedCountries: Set<string> | null;
  private readonly allowedCurrencies: Set<string> | null;
  private redisPublisher: RedisClientType | null = null;
  private redisSubscriber: RedisClientType | null = null;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {
    this.redisUrl = this.config.get<string>('REDIS_URL');
    const configuredRedisTimeout = this.config.get<number>('REDIS_CONNECT_TIMEOUT_MS');
    this.redisConnectTimeoutMs =
      typeof configuredRedisTimeout === 'number' && Number.isFinite(configuredRedisTimeout)
        ? Math.max(100, Math.min(30_000, Math.floor(configuredRedisTimeout)))
        : undefined;
    this.allowedCountries = parseCodeAllowlist(
      this.config.get<string>('ALLOWED_COUNTRIES'),
      /^[A-Z]{2}$/,
    );
    this.allowedCurrencies = parseCodeAllowlist(
      this.config.get<string>('ALLOWED_CURRENCIES'),
      /^[A-Z]{3}$/,
    );
  }

  /**
   * The local TTL remains a resilience fallback, but a kill-switch change must
   * invalidate other API replicas promptly. Redis pub/sub carries only the
   * cache key; the database remains the source of truth.
   */
  async onModuleInit(): Promise<void> {
    if (!this.redisUrl) return;
    const socketOptions = this.redisConnectTimeoutMs
      ? {
          connectTimeout: this.redisConnectTimeoutMs,
          reconnectStrategy: false as const,
        }
      : undefined;
    const publisher = createClient({
      url: this.redisUrl,
      ...(socketOptions ? { socket: socketOptions } : {}),
    });
    const subscriber = createClient({
      url: this.redisUrl,
      ...(socketOptions ? { socket: socketOptions } : {}),
    });
    const onRedisError = (error: unknown) => {
      this.logger.warn(`Runtime-config cache invalidation Redis error: ${String(error)}`);
    };
    publisher.on('error', onRedisError);
    subscriber.on('error', onRedisError);
    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      await subscriber.subscribe(RUNTIME_CONFIG_INVALIDATION_CHANNEL, (message) => {
        try {
          const parsed = JSON.parse(message) as { scope?: unknown; target?: unknown };
          if (typeof parsed.scope === 'string' && typeof parsed.target === 'string') {
            this.invalidate(parsed.scope, parsed.target);
          }
        } catch {
          this.logger.warn('Ignored malformed runtime-config cache invalidation message');
        }
      });
      this.redisPublisher = publisher;
      this.redisSubscriber = subscriber;
    } catch (error) {
      await Promise.all([
        publisher.quit().catch(() => undefined),
        subscriber.quit().catch(() => undefined),
      ]);
      this.logger.warn(`Runtime-config cache invalidation unavailable: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const publisher = this.redisPublisher;
    const subscriber = this.redisSubscriber;
    this.redisPublisher = null;
    this.redisSubscriber = null;
    await Promise.all([
      publisher?.quit().catch(() => undefined),
      subscriber?.quit().catch(() => undefined),
    ]);
  }

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

  private async publishInvalidation(scope: string, target: string): Promise<void> {
    const publisher = this.redisPublisher;
    if (!publisher?.isReady) return;
    try {
      await publisher.publish(
        RUNTIME_CONFIG_INVALIDATION_CHANNEL,
        JSON.stringify({ scope, target }),
      );
    } catch (error) {
      // The database write has already succeeded. Keep the TTL fallback and do
      // not turn a cache-notification outage into a failed operator action.
      this.logger.warn(`Runtime-config cache invalidation publish failed: ${String(error)}`);
    }
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
      create: {
        scope: key.scope,
        target: key.target,
        value: { enabled },
        reason,
        updatedBy: actorId,
      },
      update: { value: { enabled }, reason, updatedBy: actorId },
    });
    this.setCached(key.scope, key.target, enabled);
    await this.publishInvalidation(key.scope, key.target);
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
      create: {
        scope: key.scope,
        target: key.target,
        value: { values },
        reason,
        updatedBy: actorId,
      },
      update: { value: { values }, reason, updatedBy: actorId },
    });
    this.setCached(key.scope, key.target, values);
    await this.publishInvalidation(key.scope, key.target);
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
      create: {
        scope: key.scope,
        target: key.target,
        value: { value },
        reason,
        updatedBy: actorId,
      },
      update: { value: { value }, reason, updatedBy: actorId },
    });
    this.setCached(key.scope, key.target, value);
    await this.publishInvalidation(key.scope, key.target);
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
      create: { scope, target, value, reason: reason ?? null, updatedBy: actorId },
      update: { value, reason: reason ?? null, updatedBy: actorId },
    });
    this.invalidate(scope, target);
    await this.publishInvalidation(scope, target);
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
    return this.getBoolean(RUNTIME_CONFIG_KEYS.ADS_GLOBAL, false);
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
   * A runtime toggle alone must never expose a reward-bearing ad surface.
   * The API configuration is intentionally checked here (rather than trusting
   * the client) so an operator cannot enable settlement before a real
   * attestation issuer and its version allowlist are installed.
   */
  isWaitAttestationConfigured(): boolean {
    const rawIssuers = this.config.get<string>('WAIT_ATTESTATION_ISSUERS');
    const versions = (this.config.get<string>('VERIFIED_WAIT_ATTESTATION_VERSIONS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!rawIssuers || versions.length === 0) return false;
    try {
      const issuers = JSON.parse(rawIssuers) as unknown;
      return (
        Array.isArray(issuers) &&
        issuers.length > 0 &&
        issuers.every(
          (issuer) =>
            !!issuer &&
            typeof issuer === 'object' &&
            typeof (issuer as { provider?: unknown }).provider === 'string' &&
            typeof (issuer as { issuer?: unknown }).issuer === 'string' &&
            typeof (issuer as { audience?: unknown }).audience === 'string' &&
            !!(issuer as { publicKeys?: unknown }).publicKeys &&
            typeof (issuer as { publicKeys?: unknown }).publicKeys === 'object' &&
            Object.keys((issuer as { publicKeys: Record<string, unknown> }).publicKeys).length > 0,
        )
      );
    } catch {
      return false;
    }
  }

  /** Return the deployment marker used for sandbox/production boundaries. */
  getEnvironmentKind(): string {
    return this.config.get<string>('WAITLAYER_ENVIRONMENT_KIND', 'development');
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
    return earningsEnabled && this.isWaitAttestationConfigured()
      ? 'earnings_enabled'
      : 'telemetry_only';
  }

  async isDepositsEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.DEPOSITS_GLOBAL, false);
  }

  async isPayoutRequestsEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.PAYOUT_REQUESTS, false);
  }

  async isAutoPayoutProcessingEnabled(): Promise<boolean> {
    return this.getBoolean(RUNTIME_CONFIG_KEYS.PAYOUT_AUTO, false);
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
    if (this.allowedCountries) {
      return !!country && this.allowedCountries.has(country.trim().toUpperCase());
    }
    if (!country) return true;
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_COUNTRIES, []);
    return !blocked.includes(country.toUpperCase());
  }

  async isCurrencyAllowed(currency: string | null | undefined): Promise<boolean> {
    if (this.allowedCurrencies) {
      return !!currency && this.allowedCurrencies.has(currency.trim().toUpperCase());
    }
    if (!currency) return true;
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_CURRENCIES, []);
    return !blocked.includes(currency.toUpperCase());
  }

  async isExtensionVersionAllowed(version: string | null | undefined): Promise<boolean> {
    const normalizedVersion = version?.trim();
    const blocked = await this.getStringArray(RUNTIME_CONFIG_KEYS.BLOCKED_EXTENSION_VERSIONS, []);
    if (normalizedVersion && blocked.includes(normalizedVersion)) return false;
    const minVersion = await this.getString(RUNTIME_CONFIG_KEYS.EXTENSION_MIN_VERSION, null);
    if (!minVersion) return !normalizedVersion || semver.valid(normalizedVersion) !== null;
    const normalizedMinimum = minVersion.trim();
    if (
      !normalizedVersion ||
      !semver.valid(normalizedVersion) ||
      !semver.valid(normalizedMinimum)
    ) {
      return false;
    }
    return semver.gte(normalizedVersion, normalizedMinimum);
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
}

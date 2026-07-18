import { createHash } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { assertSafeJson } from '../common/utils/json-value';
import { PrismaService } from '../config/prisma.service';
import { CURRENT_CONSENT_VERSIONS } from './consent-versions';

const REQUIRED_GRANTED_CONSENT_PURPOSES = new Set(['privacy_policy', 'terms_of_service']);
const ALLOWED_CONSENT_PURPOSES = new Set([
  ...Object.keys(CURRENT_CONSENT_VERSIONS),
  'ccpa_opt_out',
]);
const MAX_CONSENT_EVENTS_PER_PURPOSE = 1_000;

const DEFAULT_RETENTION_DAYS: Record<string, number> = {
  webhook_events: 90,
  audit_logs: 365,
  sessions: 30,
  export_cache: 7,
};
const RETENTION_BATCH_SIZE = 500;
const RETENTION_MAX_BATCHES_PER_CATEGORY = 10;

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ── Consent ──────────────────────────────────────────────
  async recordConsent(
    userId: string,
    actorRole: string,
    purpose: string,
    version: string,
    granted = true,
    metadata?: Record<string, unknown>,
  ) {
    if (!ALLOWED_CONSENT_PURPOSES.has(purpose)) {
      throw new BadRequestException(`Unsupported consent purpose: ${purpose}`);
    }
    const currentVersion =
      CURRENT_CONSENT_VERSIONS[purpose as keyof typeof CURRENT_CONSENT_VERSIONS] ??
      CURRENT_CONSENT_VERSIONS.privacy_policy;
    if (version !== currentVersion) {
      throw new BadRequestException(`Consent version for ${purpose} is not current`);
    }
    // Validate user-supplied consent metadata before it is persisted to the
    // JSON column (rejects prototype-pollution / non-serializable input).
    if (metadata) {
      try {
        assertSafeJson(metadata, `consent.${purpose}`);
      } catch {
        throw new BadRequestException('Consent metadata is not a valid JSON value');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user-consent:${userId}:${purpose}`}))`;
      const existing = await tx.consent.findFirst({
        where: { userId, purpose },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && existing.granted === granted && existing.version === version) {
        return existing;
      }
      const count = await tx.consent.count({ where: { userId, purpose } });
      if (count >= MAX_CONSENT_EVENTS_PER_PURPOSE) {
        throw new BadRequestException(
          `Consent history limit reached for ${purpose}; contact support to record another change`,
        );
      }
      const row = await tx.consent.create({
        data: { userId, purpose, version, granted, metadata: metadata as object | undefined },
      });
      // Consent rows are legal evidence; the audit must be part of the same
      // transaction so a rolled-back consent never leaves a success record.
      await this.audit.logStrict(
        {
          actorId: userId,
          actorRole,
          action: granted ? 'consent_granted' : 'consent_revoked',
          targetType: 'consent',
          targetId: row.id,
        },
        tx,
      );
      return row;
    });
  }

  /**
   * Records privacy-minimized consent for LOGGED-OUT (anonymous) visitors.
   * Stores a Consent row with `userId: null` and only a sha256 hash of a
   * client-generated pseudonymous `visitorId` (never the raw id, IP, or other
   * PII). The purpose must be an allowed consent purpose and `policyVersion`
   * defaults to the current required version when omitted.
   *
   * Idempotent per (visitorIdHash, purpose): a repeat recording for the same
   * visitor + purpose updates the existing row instead of duplicating it.
   */
  async recordAnonymousConsent(dto: {
    visitorId: string;
    purpose: string;
    granted?: boolean;
    policyVersion?: string;
  }) {
    if (!dto.visitorId || typeof dto.visitorId !== 'string') {
      throw new BadRequestException('visitorId is required');
    }
    if (!(dto.purpose in CURRENT_CONSENT_VERSIONS)) {
      throw new BadRequestException(`Unsupported consent purpose: ${dto.purpose}`);
    }

    const visitorIdHash = createHash('sha256').update(dto.visitorId).digest('hex');
    const granted = dto.granted ?? true;
    const currentVersion =
      CURRENT_CONSENT_VERSIONS[dto.purpose as keyof typeof CURRENT_CONSENT_VERSIONS];
    if (dto.policyVersion && dto.policyVersion !== currentVersion) {
      throw new BadRequestException(`Consent version for ${dto.purpose} is not current`);
    }
    const version = currentVersion;

    return this.prisma.$transaction(async (tx) => {
      // Serialize the logical visitor+purpose stream. A transaction without
      // this lock does not make find-then-create safe at READ COMMITTED: two
      // concurrent choices could both observe no current row and append the
      // same state. The lock also gives us a deterministic latest-choice read.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`anonymous-consent:${visitorIdHash}:${dto.purpose}`}))`;
      const existing = await tx.consent.findFirst({
        where: { visitorIdHash, purpose: dto.purpose },
        orderBy: { createdAt: 'desc' },
      });

      // Exact replay is idempotent. A changed choice is append-only so grant →
      // revoke → grant remains a legally useful history rather than mutating
      // the original evidence row in place.
      if (existing && existing.granted === granted && existing.version === version) {
        return existing;
      }
      const row = await tx.consent.create({
        data: {
          userId: null,
          visitorIdHash,
          purpose: dto.purpose,
          version,
          granted,
          metadata: { method: 'anonymous_cookie' },
        },
      });
      // Consent rows are legal evidence; the audit must be part of the same
      // transaction so a rolled-back consent never leaves a success record.
      await this.audit.logStrict(
        {
          actorId: 'anonymous',
          actorRole: 'anonymous',
          action: granted ? 'consent_granted' : 'consent_revoked',
          targetType: 'consent',
          targetId: row.id,
        },
        tx,
      );
      return row;
    });
  }

  async getConsent(userId: string, purpose: string) {
    return this.prisma.consent.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
    });
  }

  async isConsented(userId: string, purpose: string, version?: string): Promise<boolean> {
    const row = await this.getConsent(userId, purpose);
    if (!row || !row.granted) return false;
    if (version && row.version !== version) return false;
    return true;
  }

  /** The latest policy/terms versions users are required to have accepted. */
  getRequiredConsentVersions(): Record<string, string> {
    return { ...CURRENT_CONSENT_VERSIONS };
  }

  /**
   * Returns the consent purposes whose user-held version is stale relative to
   * {@link CURRENT_CONSENT_VERSIONS}. Used by the re-prompt flow (#65) to
   * decide whether the web UI must ask the user to re-consent. A purpose the
   * user never consented to, or consented to a revoked version, is reported.
   */
  async getStaleConsents(userId: string): Promise<string[]> {
    const stale: string[] = [];
    for (const [purpose, version] of Object.entries(CURRENT_CONSENT_VERSIONS)) {
      const row = await this.getConsent(userId, purpose);
      const hasCurrentChoice = row?.version === version;
      const requiresGrant = REQUIRED_GRANTED_CONSENT_PURPOSES.has(purpose);
      // Optional consent (currently marketing cookies) is current once the
      // user made an explicit choice for this policy version. Treating a
      // current `granted=false` row as stale causes an endless re-prompt and
      // pressures users to reverse a valid privacy choice.
      if (!hasCurrentChoice || (requiresGrant && !row?.granted)) stale.push(purpose);
    }
    return stale;
  }

  // ── Retention ────────────────────────────────────────────
  /** Seed default retention windows on first run if absent. */
  async ensureRetentionDefaults() {
    for (const [category, days] of Object.entries(DEFAULT_RETENTION_DAYS)) {
      await this.prisma.dataRetentionConfig.upsert({
        where: { category },
        update: {},
        create: { category, retainDays: days },
      });
    }
  }

  /** Purge one category's rows older than its configured retention window. */
  async purge(category: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const cfg = await tx.dataRetentionConfig.findUnique({ where: { category } });
      return this.purgeConfiguredCategory(tx, category, cfg?.retainDays);
    });
  }

  async runAllRetention() {
    return this.prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext('waitlayer-retention-cron')) AS "acquired"
        `;
        if (!lockRows[0]?.acquired) {
          this.logger.warn('Retention purge is running on another replica — skipping this tick');
          return { acquired: false, deleted: 0 };
        }
        const cfgs = await tx.dataRetentionConfig.findMany({
          orderBy: { category: 'asc' },
          take: 100,
        });
        let deleted = 0;
        for (const cfg of cfgs) {
          deleted += await this.purgeConfiguredCategory(tx, cfg.category, cfg.retainDays);
        }
        return { acquired: true, deleted };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 },
    );
  }

  private async purgeConfiguredCategory(
    tx: Prisma.TransactionClient,
    category: string,
    retainDays: number | null | undefined,
  ): Promise<number> {
    if (retainDays === null || retainDays === undefined) return 0;
    if (!Number.isInteger(retainDays) || retainDays <= 0) {
      throw new Error(`Invalid retention window for ${category}: retainDays must be positive`);
    }
    if (category === 'export_cache') return 0;
    if (!['webhook_events', 'audit_logs', 'sessions'].includes(category)) {
      this.logger.warn(`Unknown retention category: ${category}`);
      return 0;
    }

    const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
    let deleted = 0;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_CATEGORY; batch++) {
      const count = await this.deleteRetentionBatch(tx, category, cutoff);
      deleted += count;
      if (count < RETENTION_BATCH_SIZE) break;
    }
    this.logger.log(
      `Retention purge: category=${category} deleted=${deleted} before ${cutoff.toISOString()}`,
    );
    return deleted;
  }

  private deleteRetentionBatch(
    tx: Prisma.TransactionClient,
    category: string,
    cutoff: Date,
  ): Promise<number> {
    if (category === 'webhook_events') {
      return tx.$executeRaw`
        WITH doomed AS (
          SELECT "id" FROM "webhook_events"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt", "id"
          LIMIT ${RETENTION_BATCH_SIZE}
        )
        DELETE FROM "webhook_events" target
        USING doomed
        WHERE target."id" = doomed."id"
      `;
    }
    if (category === 'audit_logs') {
      return tx.$executeRaw`
        WITH doomed AS (
          SELECT "id" FROM "audit_logs"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt", "id"
          LIMIT ${RETENTION_BATCH_SIZE}
        )
        DELETE FROM "audit_logs" target
        USING doomed
        WHERE target."id" = doomed."id"
      `;
    }
    // Sessions retain for N days after expiry, mirroring the previous policy.
    return tx.$executeRaw`
      WITH doomed AS (
        SELECT "id" FROM "sessions"
        WHERE "expiresAt" < ${cutoff}
        ORDER BY "expiresAt", "id"
        LIMIT ${RETENTION_BATCH_SIZE}
      )
      DELETE FROM "sessions" target
      USING doomed
      WHERE target."id" = doomed."id"
    `;
  }
}

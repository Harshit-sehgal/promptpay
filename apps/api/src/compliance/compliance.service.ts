import { BadRequestException,Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { assertSafeJson } from '../common/utils/json-value';
import { PrismaService } from '../config/prisma.service';

const DEFAULT_RETENTION_DAYS: Record<string, number> = {
  webhook_events: 90,
  audit_logs: 365,
  sessions: 30,
  export_cache: 7,
};

// Current policy/terms versions users must have consented to. Bump these
// strings whenever the privacy policy / terms / cookie notice materially
// change — the re-prompt flow (#65) compares a user's latest consent version
// against these to decide whether to ask again.
const CURRENT_CONSENT_VERSIONS: Record<string, string> = {
  privacy_policy: '2026-07-01',
  terms_of_service: '2026-07-01',
  marketing_cookies: '2026-07-01',
};

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
    // Validate user-supplied consent metadata before it is persisted to the
    // JSON column (rejects prototype-pollution / non-serializable input).
    if (metadata) {
      try {
        assertSafeJson(metadata, `consent.${purpose}`);
      } catch {
        throw new BadRequestException('Consent metadata is not a valid JSON value');
      }
    }
    const row = await this.prisma.consent.create({
      data: { userId, purpose, version, granted, metadata: metadata as object | undefined },
    });
    void this.audit.log({
      actorId: userId,
      actorRole,
      action: granted ? 'consent_granted' : 'consent_revoked',
      targetType: 'consent',
      targetId: row.id,
    });
    return row;
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
      const current = await this.isConsented(userId, purpose, version);
      if (!current) stale.push(purpose);
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
    const cfg = await this.prisma.dataRetentionConfig.findUnique({ where: { category } });
    if (!cfg || cfg.retainDays === null || cfg.retainDays === undefined) {
      return 0; // retain indefinitely
    }
    const cutoff = new Date(Date.now() - cfg.retainDays * 24 * 60 * 60 * 1000);
    let deleted = 0;
    switch (category) {
      case 'webhook_events':
        deleted = (
          await this.prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
        ).count;
        break;
      case 'audit_logs':
        deleted = (await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }))
          .count;
        break;
      case 'sessions':
        // Sessions expire by `expiresAt`; purge those already past the cutoff.
        deleted = (
          await this.prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } })
        ).count;
        break;
      case 'export_cache':
        // No dedicated table; export responses are not persisted server-side.
        return 0;
      default:
        this.logger.warn(`Unknown retention category: ${category}`);
        return 0;
    }
    this.logger.log(`Retention purge: category=${category} deleted=${deleted} before ${cutoff.toISOString()}`);
    return deleted;
  }

  async runAllRetention() {
    const cfgs = await this.prisma.dataRetentionConfig.findMany();
    for (const cfg of cfgs) {
      await this.purge(cfg.category);
    }
  }
}

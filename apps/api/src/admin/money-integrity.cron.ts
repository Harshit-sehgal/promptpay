import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { AdminService } from './admin.service';

/**
 * Continuous money-integrity monitor.
 *
 * The admin `GET /admin/money-integrity` report already proves that
 * campaign spend matches advertiser ledger debits, the global split
 * (developer + platform + reserve) reconciles to advertiser spend, and no
 * developer has a negative confirmed balance. But an on-demand report only
 * catches drift when a human remembers to look.
 *
 * This cron runs that reconciliation on a fixed interval and, the moment any
 * discrepancy appears, writes an immutable audit trail and logs at high
 * severity. For a fintech/ad-network this is the difference between
 * "we can manually check the books" and "the system watches the books for
 * us 24/7" — which is the trust signal that makes a money product credible.
 *
 * The check is read-only: it never mutates ledgers. Discrepancies are
 * surfaced for human/automated review, not auto-corrected, so a transient
 * reconciliation window can never be "fixed" by a destructive write.
 */
@Injectable()
export class MoneyIntegrityCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MoneyIntegrityCronService.name);

  /** 15 minutes. Long enough that the heavy aggregation is cheap at scale,
   *  short enough that a real discrepancy is caught quickly. */
  private static readonly INTERVAL_MS = 15 * 60 * 1000;

  private intervalId?: NodeJS.Timeout;
  private startupTimeoutId?: NodeJS.Timeout;
  private running = false;

  constructor(
    private admin: AdminService,
    private audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.intervalId = setInterval(() => void this.tick(), MoneyIntegrityCronService.INTERVAL_MS);
    // Run once shortly after boot so a fresh deploy surfaces any pre-existing
    // drift without waiting a full interval.
    this.startupTimeoutId = setTimeout(() => void this.tick(), 30_000);
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.startupTimeoutId) clearTimeout(this.startupTimeoutId);
  }

  private async tick() {
    if (this.running) return; // guard against overlap if a scan overruns the interval
    this.running = true;
    try {
      const report = await this.admin.getMoneyIntegrityReport();
      if (report.status === 'healthy') return;

      const discrepancies = [
        ...report.campaignDiscrepancies.map(
          (d) =>
            `campaign ${d.campaignId} (${d.campaignName}): currency=${d.currency} spend=${d.budgetSpentMinor} debits=${d.ledgerDebits} diff=${d.diff}`,
        ),
        ...report.negativeDeveloperBalances.map(
          (b) =>
            `developer ${b.userId} (${b.email}): currency=${b.currency} negative balance=${b.balanceMinor}`,
        ),
      ];

      const globalDiscrepancies = Object.fromEntries(
        Object.entries(
          report.globalReconciliationByCurrency ?? { USD: report.globalReconciliation },
        ).map(([currency, row]) => [currency, row.discrepancyMinor]),
      );
      const totalDiff = Math.max(
        0,
        ...Object.values(globalDiscrepancies).map((diff) => Math.abs(diff)),
      );
      const severity =
        totalDiff > 0 || report.negativeDeveloperBalances.length > 0 ? 'high' : 'medium';

      this.logger.error(
        `[MONEY INTEGRITY] (${severity}) ${discrepancies.length} discrepancy(ies) detected. ` +
          `globalDiscrepancyByCurrency=${JSON.stringify(globalDiscrepancies)}. ` +
          discrepancies.join('; '),
      );

      void this.audit.log({
        actorId: 'system',
        actorRole: 'system',
        action: 'money_integrity_discrepancy',
        targetType: 'ledger',
        targetId: 'global',
        afterSnap: {
          status: report.status,
          severity,
          globalDiscrepancyMinor: report.globalReconciliation.discrepancyMinor,
          globalDiscrepancyByCurrency: globalDiscrepancies,
          campaignDiscrepancies: report.campaignDiscrepancies,
          negativeDeveloperBalances: report.negativeDeveloperBalances,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[MONEY INTEGRITY] reconciliation scan failed: ${msg}`);
    } finally {
      this.running = false;
    }
  }
}

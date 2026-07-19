import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { AlertsService } from '../observability/alerts.service';
import { MetricsService } from '../observability/metrics.service';
import { AdminService } from './admin.service';
import { MoneyIntegrityCronService } from './money-integrity.cron';

function makeCron(
  overrides: {
    report?: 'healthy' | 'drift';
    opsAlertEmail?: string;
    emailFails?: boolean;
  } = {},
) {
  const report =
    overrides.report === 'drift'
      ? {
          status: 'discrepancy',
          globalReconciliation: { discrepancyMinor: 500n, currency: 'USD' },
          globalReconciliationByCurrency: { USD: { discrepancyMinor: 500n, currency: 'USD' } },
          campaignDiscrepancies: [
            {
              campaignId: 'c1',
              campaignName: 'Camp',
              currency: 'USD',
              budgetSpentMinor: 1000n,
              ledgerDebits: 900n,
              diff: 100n,
            },
          ],
          negativeDeveloperBalances: [],
        }
      : {
          status: 'healthy',
          globalReconciliation: { discrepancyMinor: 0n, currency: 'USD' },
          campaignDiscrepancies: [],
          negativeDeveloperBalances: [],
        };

  const admin = {
    getMoneyIntegrityReport: vi.fn().mockResolvedValue(report),
  } as unknown as AdminService;
  const audit = {
    logStrict: vi.fn().mockResolvedValue(undefined),
    countDeadLetter: vi.fn().mockResolvedValue(overrides.report === 'drift' ? 2 : 0),
  } as unknown as AuditService;
  const prisma = {
    // acquireCronLease runs a $queryRaw that returns the leasing owner's row.
    // Returning a non-empty array grants the lease to this owner.
    $queryRaw: vi.fn().mockResolvedValue([{ key: 'granted' }]),
  } as unknown as PrismaService;
  const emailQueue = {
    sendMoneyIntegrityAlert: vi.fn(
      overrides.emailFails
        ? () => Promise.reject(new Error('Resend down'))
        : () => Promise.resolve({ delivered: true, driver: 'console' }),
    ),
  } as unknown as EmailQueueService;
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'OPS_ALERT_EMAIL') return overrides.opsAlertEmail;
      return undefined;
    }),
  } as unknown as ConfigService;
  const metrics = {
    increment: vi.fn(),
    gauge: vi.fn(),
    snapshot: vi.fn().mockReturnValue({ counters: {}, gauges: {} }),
    recordLedgerDiscrepancy: vi.fn(),
    recordFailedAuditRows: vi.fn(),
  } as unknown as MetricsService;
  const alerts = {
    alert: vi.fn(),
    alertLedgerDiscrepancy: vi.fn(),
    alertNegativeAdvertiserBalance: vi.fn(),
    alertCampaignOverBudget: vi.fn(),
    alertAuditDeadLetter: vi.fn(),
  } as unknown as AlertsService;

  const cron = new MoneyIntegrityCronService(
    admin,
    audit,
    prisma,
    emailQueue,
    config,
    metrics,
    alerts,
  );
  return { cron, admin, audit, emailQueue, config, metrics, alerts };
}

describe('MoneyIntegrityCronService alerting', () => {
  it('does nothing when the report is healthy', async () => {
    const { cron, audit, emailQueue } = makeCron({ report: 'healthy', opsAlertEmail: 'ops@x.com' });
    // tick is private; call via the public bootstrap path is heavy, so invoke
    // the private method directly via a cast to keep the test focused.
    await (cron as unknown as { tick: () => Promise<void> }).tick();
    expect(audit.logStrict).not.toHaveBeenCalled();
    expect(emailQueue.sendMoneyIntegrityAlert).not.toHaveBeenCalled();
  });

  it('writes an audit row AND sends an operator alert email on drift', async () => {
    const { cron, audit, emailQueue } = makeCron({
      report: 'drift',
      opsAlertEmail: 'ops@waitlayer.com',
    });
    await (cron as unknown as { tick: () => Promise<void> }).tick();
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'money_integrity_discrepancy' }),
    );
    expect(emailQueue.sendMoneyIntegrityAlert).toHaveBeenCalledWith(
      'ops@waitlayer.com',
      expect.objectContaining({ severity: 'high', campaignDiscrepancyCount: 1 }),
    );
  });

  it('still completes when the alert email fails (audit row is the durable record)', async () => {
    const { cron, audit, emailQueue } = makeCron({
      report: 'drift',
      opsAlertEmail: 'ops@waitlayer.com',
      emailFails: true,
    });
    // Must not throw — the cron swallows the email failure.
    await expect(
      (cron as unknown as { tick: () => Promise<void> }).tick(),
    ).resolves.toBeUndefined();
    expect(audit.logStrict).toHaveBeenCalled();
    expect(emailQueue.sendMoneyIntegrityAlert).toHaveBeenCalled();
  });

  it('logs a warning when OPS_ALERT_EMAIL is not set', async () => {
    const { cron, emailQueue } = makeCron({ report: 'drift', opsAlertEmail: undefined });
    await (cron as unknown as { tick: () => Promise<void> }).tick();
    expect(emailQueue.sendMoneyIntegrityAlert).not.toHaveBeenCalled();
  });
  it('records observability metrics + alerts on drift (P1.24/P1.25)', async () => {
    const { cron, metrics, alerts } = makeCron({ report: 'drift', opsAlertEmail: 'ops@x.com' });
    await (cron as unknown as { tick: () => Promise<void> }).tick();
    expect(metrics.recordLedgerDiscrepancy).toHaveBeenCalled();
    expect(alerts.alertLedgerDiscrepancy).toHaveBeenCalled();
    expect(alerts.alertCampaignOverBudget).toHaveBeenCalled();
    expect(alerts.alertAuditDeadLetter).toHaveBeenCalled();
    expect(metrics.recordFailedAuditRows).toHaveBeenCalledWith(2);
  });
});

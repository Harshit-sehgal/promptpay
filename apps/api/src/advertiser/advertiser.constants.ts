import { BadRequestException } from '@nestjs/common';

import { CampaignStatus } from '@waitlayer/shared';

/**
 * Build the Prisma `createdAt` filter for advertiser reports (issue A-050).
 *
 * A date-ONLY `to` (no 'T', e.g. "2026-07-09") is parsed by `new Date(...)`
 * as midnight at the START of that day, which would exclude every event that
 * happened later on the selected end day. We instead treat a date-only `to`
 * as inclusive-of-the-day by using an exclusive next-day UTC lower bound
 * (`lt`); ISO datetimes keep an inclusive upper bound (`lte`). The next-day
 * bound is computed in UTC so it lines up with how `new Date(params.to)`
 * parses a date-only string (UTC midnight).
 *
 * Exported so the date-bound semantics can be unit-tested without invoking the
 * SQL aggregation path (A-068).
 */
// A-032: bound advertiser report/export queries so a single request cannot
// pull unbounded rows or an arbitrarily wide date range (memory/DoS safety).
// These are product-tunable caps; the web UI sends no `page`/`limit` today, so
// its behavior is unchanged (all campaigns are returned unless a caller asks).
export const REPORT_MAX_LIMIT = 1000;

export const REPORT_MAX_RANGE_DAYS = 366;

export const ADVERTISER_EXPORT_LIMITS = {
  campaigns: 1000,
  creatives: 2000,
  billingLedger: 10000,
  consents: 1000,
};

// A-074: bound the heavy campaign payload returned by getDashboard. Only a
// recent slice is loaded with creative/approval includes for display; the
// account-wide impression/click counts use nested-relation counts.
export const DASHBOARD_CAMPAIGN_SLICE = 20;

export function buildReportsDateFilter(
  from: string | undefined,
  to: string | undefined,
  maxRangeDays: number = REPORT_MAX_RANGE_DAYS,
): {
  gte?: Date;
  lte?: Date;
  lt?: Date;
} {
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(to) : undefined;
  if (gte && Number.isNaN(gte.getTime())) {
    throw new BadRequestException(`Invalid 'from' date: ${from}`);
  }
  if (lte && Number.isNaN(lte.getTime())) {
    throw new BadRequestException(`Invalid 'to' date: ${to}`);
  }
  const createdAt: {
    gte?: Date;
    lte?: Date;
    lt?: Date;
  } = {};
  if (gte) createdAt.gte = gte;
  if (to) {
    if (to.includes('T')) {
      createdAt.lte = lte;
    } else {
      const toUtc = new Date(`${to}T00:00:00.000Z`);
      createdAt.lt = new Date(toUtc.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  // Reject report ranges wider than the allowed span (A-032). The effective
  // upper bound is `lte` for ISO datetimes or the next-day `lt` for date-only
  // `to` (inclusive of the whole end day).
  const effectiveTo = createdAt.lte ?? createdAt.lt;
  if (gte && effectiveTo) {
    const spanDays = (effectiveTo.getTime() - gte.getTime()) / (24 * 60 * 60 * 1000);
    if (spanDays > maxRangeDays) {
      throw new BadRequestException(
        `Report date range exceeds the maximum allowed span of ${maxRangeDays} days`,
      );
    }
  }
  return createdAt;
}

/** Valid campaign status transitions */
export const CAMPAIGN_TRANSITIONS: Record<string, CampaignStatus[]> = {
  draft: [CampaignStatus.SUBMITTED],
  submitted: [CampaignStatus.APPROVED, CampaignStatus.REJECTED],
  approved: [CampaignStatus.ACTIVE, CampaignStatus.REJECTED],
  active: [CampaignStatus.PAUSED],
  paused: [CampaignStatus.ACTIVE],
  rejected: [CampaignStatus.DRAFT],
  archived: [],
};

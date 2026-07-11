import { FraudFlagStatus, FraudSeverity, Prisma } from '@waitlayer/db';

import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';

export class AdminFraudTrait {
  declare prisma: PrismaService;
  declare fraudService: FraudService;

  async recomputeTrustScore(userId: string) {
    return this.fraudService.computeTrustScore(userId);
  }

  async getFraudFlags(params: {
    status?: string;
    severity?: string;
    flagType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.FraudFlagWhereInput = {};
    // Support comma-separated statuses: "open,reviewing" or "resolved_valid,resolved_invalid"
    if (params.status) {
      const statuses = params.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        where.status = statuses[0] as FraudFlagStatus;
      } else if (statuses.length > 1) {
        where.status = { in: statuses as FraudFlagStatus[] };
      }
    }
    if (params.severity) where.severity = params.severity as FraudSeverity;
    if (params.flagType)
      (
        where as {
          flagType: string;
        }
      ).flagType = params.flagType;
    // Search by user email
    if (params.search) {
      const matchingUsers = await this.prisma.user.findMany({
        where: {
          email: { contains: params.search, mode: 'insensitive' },
        },
        select: { id: true },
      });
      where.userId = { in: matchingUsers.map((u) => u.id) };
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 20));
    const [flags, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, name: true, trustLevel: true } },
        },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);
    return {
      flags,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFraudStats() {
    const [byStatus, bySeverity, byFlagType, total, resolved7d, resolvedFlags] = await Promise.all([
      Promise.all(
        (
          [
            'open',
            'reviewing',
            'resolved_valid',
            'resolved_invalid',
            'escalated',
          ] as FraudFlagStatus[]
        ).map((status) => this.prisma.fraudFlag.count({ where: { status } })),
      ),
      Promise.all(
        (['critical', 'high', 'medium', 'low'] as FraudSeverity[]).map((severity) =>
          this.prisma.fraudFlag.count({
            where: { severity, status: { in: ['open', 'reviewing'] as FraudFlagStatus[] } },
          }),
        ),
      ),
      this.prisma.fraudFlag.groupBy({
        by: ['flagType'],
        _count: { _all: true },
        where: { status: { in: ['open', 'reviewing'] as FraudFlagStatus[] } },
      }),
      this.prisma.fraudFlag.count(),
      this.prisma.fraudFlag.count({
        where: {
          status: { in: ['resolved_valid', 'resolved_invalid'] as FraudFlagStatus[] },
          resolvedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      // Fetch resolved flags with createdAt + resolvedAt to compute avg resolution time in-memory
      // (Prisma's _avg does not support DateTime fields in TypeScript types)
      this.prisma.fraudFlag.findMany({
        where: { resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        take: 1000, // Sanity cap — enough for a meaningful average
      }),
    ]);
    const [open, reviewing, resolvedValid, resolvedInvalid, escalated] = byStatus;
    const [critical, high, medium, low] = bySeverity;
    const totalResolved = resolvedValid + resolvedInvalid;
    const escalationRate =
      totalResolved > 0 ? Math.round((resolvedValid / totalResolved) * 100) : 0;
    // Calculate average resolution time in minutes (in-memory)
    let avgResolutionMins = 0;
    if (resolvedFlags.length > 0) {
      let totalMs = 0;
      let count = 0;
      for (const f of resolvedFlags) {
        if (f.createdAt && f.resolvedAt) {
          totalMs += new Date(f.resolvedAt).getTime() - new Date(f.createdAt).getTime();
          count++;
        }
      }
      avgResolutionMins = count > 0 ? Math.round(totalMs / count / (1000 * 60)) : 0;
    }
    return {
      byStatus: { open, reviewing, resolvedValid, resolvedInvalid, escalated },
      bySeverity: { critical, high, medium, low },
      byFlagType: byFlagType.map((t) => ({ type: t.flagType, count: t._count._all })),
      total,
      resolvedLast7d: resolved7d,
      escalationRate,
      avgResolutionMinutes: avgResolutionMins,
    };
  }

  async resolveFraudFlag(flagId: string, reviewerId: string, decision: string, note?: string) {
    // Delegate to FraudService.resolveFlag so admin and non-admin paths share
    // the same earnings reversal / release + trust recompute logic.
    // decision: 'confirmed' = fraud was valid (reverse earnings)
    //           'rejected' = false positive (release held earnings)
    const isValid = decision === 'confirmed';
    return this.fraudService.resolveFlag(flagId, reviewerId, isValid, note);
  }
}

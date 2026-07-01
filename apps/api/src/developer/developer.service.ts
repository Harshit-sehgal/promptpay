import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class DeveloperService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { trustLevel: true, status: true, role: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'developer') throw new ForbiddenException('Not a developer account');
    const earnings = await this.getEarningsSummary(userId);
    const trustScore = await this.prisma.trustScore.findUnique({ where: { userId } });
    const settings = await this.prisma.userSettings.findUnique({ where: { userId } });
    const isHeld = user.trustLevel === 'new' || user.trustLevel === 'restricted' || user.trustLevel === 'banned';
    return { ...earnings, trustLevel: user.trustLevel, payoutHoldStatus: { isHeld, reason: isHeld ? `Account trust level: ${user.trustLevel}` : undefined }, settings, trustScore: trustScore?.score ?? 40 };
  }

  async getEarningsSummary(userId: string) {
    const entries = await this.prisma.earningsLedger.findMany({ where: { userId }, select: { status: true, amountMinor: true } });
    const summary = { estimatedEarnings: 0, confirmedEarnings: 0, pendingEarnings: 0, heldEarnings: 0, availableForPayout: 0, lifetimeEarnings: 0 };
    for (const entry of entries) {
      summary.lifetimeEarnings += entry.amountMinor;
      if (entry.status === 'estimated') summary.estimatedEarnings += entry.amountMinor;
      else if (entry.status === 'pending') summary.pendingEarnings += entry.amountMinor;
      else if (entry.status === 'confirmed') summary.confirmedEarnings += entry.amountMinor;
      else if (entry.status === 'held') summary.heldEarnings += entry.amountMinor;
    }
    summary.availableForPayout = summary.confirmedEarnings;
    return summary;
  }

  async getEarnings(userId: string, params: { status?: string; from?: string; to?: string; page?: number; limit?: number }) {
    const where: any = { userId };
    if (params.status) where.status = params.status;
    if (params.from || params.to) { where.createdAt = {}; if (params.from) where.createdAt.gte = new Date(params.from); if (params.to) where.createdAt.lte = new Date(params.to); }
    const page = params.page ?? 1; const limit = params.limit ?? 20;
    const [entries, total] = await Promise.all([
      this.prisma.earningsLedger.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.earningsLedger.count({ where }),
    ]);
    return { entries, total, page, limit };
  }

  async getSettings(userId: string) { return this.prisma.userSettings.findUnique({ where: { userId } }); }

  async updateSettings(userId: string, dto: { adsEnabled?: boolean; quietMode?: boolean; maxAdsPerHour?: number }) {
    return this.prisma.userSettings.upsert({ where: { userId }, update: dto, create: { userId, ...dto } });
  }

  async exportData(userId: string) {
    const [user, earnings, impressions, clicks, payouts] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.earningsLedger.findMany({ where: { userId } }),
      this.prisma.adImpression.findMany({ where: { userId }, take: 1000 }),
      this.prisma.adClick.findMany({ where: { userId }, take: 1000 }),
      this.prisma.payoutRequest.findMany({ where: { userId } }),
    ]);
    return { user, earnings, impressions, clicks, payouts };
  }

  async deleteAccount(userId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { status: 'deleted', email: `deleted-${userId}@waitlayer.com` } });
  }
}

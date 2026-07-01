import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getOverview() {
    const [users, campaigns, impressions, payouts, fraudFlags] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.campaign.count({ where: { status: 'active' } }),
      this.prisma.adImpression.count({ where: { isBillable: true } }),
      this.prisma.earningsLedger.aggregate({ where: { status: 'paid' }, _sum: { amountMinor: true } }),
      this.prisma.fraudFlag.count({ where: { status: 'open' } }),
    ]);
    return { activeUsers: users, activeCampaigns: campaigns, totalBillableImpressions: impressions, totalPayoutsMinor: payouts._sum.amountMinor || 0, openFraudFlags: fraudFlags };
  }

  async getUsers(params: { status?: string; role?: string; search?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.role) where.role = params.role;
    if (params.search) where.OR = [{ email: { contains: params.search, mode: 'insensitive' } }, { name: { contains: params.search, mode: 'insensitive' } }];
    return this.prisma.user.findMany({ where, select: { id: true, email: true, name: true, role: true, status: true, trustLevel: true, country: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async getPendingCampaigns() {
    return this.prisma.campaign.findMany({ where: { status: 'submitted' }, include: { advertiser: { select: { companyName: true } } }, orderBy: { submittedAt: 'asc' } });
  }

  async approveCampaign(campaignId: string, reviewerId: string, reason?: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'submitted') {
      throw new BadRequestException('Campaign must be in submitted status to approve');
    }
    return this.prisma.$transaction([
      this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'approved', approvedAt: new Date() } }),
      this.prisma.campaignApproval.create({ data: { campaignId, reviewerId, decision: 'approved', reason } }),
    ]);
  }

  async rejectCampaign(campaignId: string, reviewerId: string, reason: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== 'submitted') {
      throw new BadRequestException('Campaign must be in submitted status to reject');
    }
    return this.prisma.$transaction([
      this.prisma.campaign.update({ where: { id: campaignId }, data: { status: 'rejected' } }),
      this.prisma.campaignApproval.create({ data: { campaignId, reviewerId, decision: 'rejected', reason } }),
    ]);
  }

  async getPendingPayouts() {
    return this.prisma.payoutRequest.findMany({ where: { status: { in: ['requested', 'under_review'] } }, include: { user: { select: { email: true, name: true, trustLevel: true } }, payoutAccount: true }, orderBy: { createdAt: 'asc' } });
  }

  async approvePayout(payoutId: string, reviewerId: string, note?: string) {
    return this.prisma.payoutRequest.update({ where: { id: payoutId }, data: { status: 'approved', reviewerId, reviewNote: note, processedAt: new Date() } });
  }

  async rejectPayout(payoutId: string, reviewerId: string, reason: string) {
    return this.prisma.payoutRequest.update({ where: { id: payoutId }, data: { status: 'rejected', reviewerId, reviewNote: reason } });
  }

  async markPayoutPaid(payoutId: string, data: { providerTxId: string; paidAt: string; amountMinor: number; currency: string }) {
    return this.prisma.$transaction([
      this.prisma.payoutRequest.update({ where: { id: payoutId }, data: { status: 'paid', paidAt: new Date(data.paidAt) } }),
      this.prisma.payoutTransaction.create({ data: { payoutRequestId: payoutId, provider: 'manual', providerTxId: data.providerTxId, status: 'paid', paidAt: new Date(data.paidAt) } }),
    ]);
  }

  async getFraudFlags(params: { status?: string; severity?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.severity) where.severity = params.severity;
    return this.prisma.fraudFlag.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async resolveFraudFlag(flagId: string, reviewerId: string, decision: string, note?: string) {
    const status = decision === 'confirmed' ? 'resolved_valid' : 'resolved_invalid';
    return this.prisma.fraudFlag.update({ where: { id: flagId }, data: { status: status as any, reviewerId, reviewNote: note, resolvedAt: new Date() } });
  }

  async getAuditLog(params: { actorId?: string; actorRole?: string; targetType?: string; from?: string; to?: string; page?: number; limit?: number }) {
    return this.audit.query(params);
  }
}

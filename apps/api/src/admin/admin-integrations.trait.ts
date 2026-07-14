import { BadRequestException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { PrismaService } from '../config/prisma.service';

export class AdminIntegrationsTrait {
  declare prisma: PrismaService;

  // ── Tool Integrations ──
  async getToolIntegrations() {
    return this.prisma.toolIntegration.findMany({
      orderBy: { slug: 'asc' },
    });
  }

  async toggleToolIntegration(slug: string, isActive: boolean) {
    const tool = await this.prisma.toolIntegration.findUnique({ where: { slug } });
    if (!tool) throw new BadRequestException(`Tool integration "${slug}" not found`);
    // CAS-gated: only succeeds if the current isActive matches what we read.
    // Concurrent toggles by another admin produce count===0 and a clear error.
    const result = await this.prisma.toolIntegration.updateMany({
      where: { slug, isActive: tool.isActive },
      data: { isActive },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        `Tool integration "${slug}" was just toggled by another admin. Reload to see the current state.`,
      );
    }

    // AdminController is class-wide wrapped by AuditInterceptor. It records the
    // authenticated actor, target slug, request body, and pre-mutation state on
    // both success and failure. Do not emit a duplicate row with a fabricated
    // generic actor id: that previously attributed every toggle to "admin" and
    // obscured the authoritative request-level forensic event.
    return this.prisma.toolIntegration.findUnique({ where: { slug } });
  }

  // ── Webhooks ──
  async getWebhookEvents(params: {
    provider?: string;
    processingStatus?: string;
    page?: number;
    limit?: number;
  }) {
    const where: Prisma.WebhookEventWhereInput = {};
    if (params.provider) where.provider = params.provider;
    if (params.processingStatus) where.processingStatus = params.processingStatus;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return { events, total, page, limit };
  }
}

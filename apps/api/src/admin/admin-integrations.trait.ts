import { BadRequestException } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';

export class AdminIntegrationsTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;

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

    // Audit: admin tool integration toggle has fleet-wide impact (gates
    // whether developers can register devices for this tool type) —
    // forensic trail must record who toggled the integration and when.
    void this.audit
      .log({
        actorId: 'admin', // toggleToolIntegration currently has no actor id — coming in controller refactor
        actorRole: 'admin',
        action: 'toggle_tool_integration',
        targetType: 'tool_integration',
        targetId: slug,
        beforeSnap: { previousState: tool.isActive, newState: isActive },
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[AdminIntegrationsTrait] audit log failure (toggle_tool_integration): ${msg}`,
        );
      });

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

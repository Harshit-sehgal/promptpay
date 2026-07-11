import { BadRequestException } from '@nestjs/common';

import { Prisma, UserRole, UserStatus } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { DeveloperService } from '../developer/developer.service';
import { AdminService } from './admin.service';

export class AdminUsersTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare developerService: DeveloperService;

  async getUsers(params: { status?: string; role?: string; search?: string }) {
    const where: Prisma.UserWhereInput = {};
    if (params.status) where.status = params.status as UserStatus;
    if (params.role) where.role = params.role as UserRole;
    if (params.search)
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { name: { contains: params.search, mode: 'insensitive' } },
      ];
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        trustLevel: true,
        country: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // Attach the open fraud-flag count per user so the admin ops view can triage
    // accounts with active flags without a separate round-trip per row.
    const openFlags = await this.prisma.fraudFlag.groupBy({
      by: ['userId'],
      where: { status: 'open', userId: { in: users.map((u) => u.id) } },
      _count: { _all: true },
    });
    const openFlagsByUser = new Map(openFlags.map((f) => [f.userId, f._count._all]));
    return users.map((u) => ({ ...u, openFlags: openFlagsByUser.get(u.id) ?? 0 }));
  }

  /**
   * Admin-initiated account erasure (right-to-be-forgotten / ToS termination).
   * Reuses the developer self-deletion path (anonymize PII, revoke sessions &
   * API keys) but logs the action under the admin actor so the forensic trail
   * is separate from the (now-anonymized) subject row.
   */
  async eraseUser(actorId: string, actorRole: string, targetUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.role === 'super_admin') {
      throw new BadRequestException('Cannot erase a super-admin account');
    }
    await this.developerService.deleteAccount(targetUserId, {
      auditActor: {
        actorId,
        actorRole,
        action: 'admin_erased_user',
      },
    });
    return { erased: true, userId: targetUserId };
  }

  async setUserStatus(actorId: string, actorRole: string, targetUserId: string, status: string) {
    if (!AdminService.ALLOWED_ADMIN_STATUSES.includes(status as UserStatus)) {
      throw new BadRequestException(`Invalid target status: ${status}`);
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.role === 'super_admin') {
      throw new BadRequestException('Cannot change the status of a super-admin account');
    }
    if (target.status === status) {
      return target;
    }
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: status as UserStatus },
    });
    await this.audit.log({
      actorId,
      actorRole,
      action: 'admin_set_user_status',
      targetType: 'user',
      targetId: targetUserId,
      beforeSnap: { status: target.status },
      afterSnap: { status },
    });
    return updated;
  }
}

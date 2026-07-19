import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';

import { Prisma, RecoveryDebtCaseStatus } from '@waitlayer/db';

import { AuditService } from '../audit/audit.service';
import { getErrorCode } from '../common/utils/errors';
import { PrismaService } from '../config/prisma.service';
import {
  ACTIVE_RECOVERY_DEBT_CASE_STATUSES,
  DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES,
  DEFAULT_RECOVERY_DEBT_CURRENCY,
  hashDeviceRecoveryToken,
  MAX_DEVICE_RECOVERY_TOKEN_MINUTES,
  normalizeOptionalCurrency,
  normalizeOptionalToolType,
  recoveryDebtCaseKey,
  sanitizeOptionalString,
  toTerminalRecoveryDebtStatus,
} from './admin.constants';
import { validateRecoveryDebtTransition } from './admin-recovery-debt-state-machine';

export class AdminDevicesTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;

  async getAuditLog(params: {
    actorId?: string;
    actorRole?: string;
    targetType?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    return this.audit.query(params);
  }

  // ── Device Recovery ──
  async getDevices(params: {
    search?: string;
    userId?: string;
    toolType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    const skip = (page - 1) * limit;
    const search = params.search?.trim();
    const toolType = normalizeOptionalToolType(params.toolType);
    const filters: Prisma.DeviceWhereInput[] = [];
    if (params.userId) filters.push({ userId: params.userId });
    if (toolType) filters.push({ toolType });
    if (search) {
      const searchToolType = normalizeOptionalToolType(search, false);
      filters.push({
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          { userId: { contains: search, mode: 'insensitive' } },
          { fingerprintHash: { contains: search, mode: 'insensitive' } },
          { platform: { contains: search, mode: 'insensitive' } },
          { extensionVersion: { contains: search, mode: 'insensitive' } },
          { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
          { user: { is: { name: { contains: search, mode: 'insensitive' } } } },
          ...(searchToolType ? [{ toolType: searchToolType }] : []),
        ],
      });
    }
    const where: Prisma.DeviceWhereInput = filters.length > 0 ? { AND: filters } : {};
    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          userId: true,
          fingerprintHash: true,
          eventSecret: true,
          toolType: true,
          extensionVersion: true,
          platform: true,
          createdAt: true,
          lastSeenAt: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              status: true,
            },
          },
          recoveryTokens: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              reason: true,
              expiresAt: true,
              usedAt: true,
              revokedAt: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.device.count({ where }),
    ]);
    return {
      devices: devices.map((device) => ({
        id: device.id,
        userId: device.userId,
        fingerprintHash: device.fingerprintHash,
        hasEventSecret: Boolean(device.eventSecret),
        toolType: device.toolType,
        extensionVersion: device.extensionVersion,
        platform: device.platform,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        user: device.user,
        latestRecoveryToken: device.recoveryTokens[0] ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async issueDeviceRecoveryToken(params: {
    deviceId: string;
    userId: string;
    reviewerId: string;
    reviewerRole?: string;
    reason?: string;
    expiresInMinutes?: number;
  }) {
    const expiresInMinutes = params.expiresInMinutes ?? DEFAULT_DEVICE_RECOVERY_TOKEN_MINUTES;
    if (
      !Number.isInteger(expiresInMinutes) ||
      expiresInMinutes < 5 ||
      expiresInMinutes > MAX_DEVICE_RECOVERY_TOKEN_MINUTES
    ) {
      throw new BadRequestException(
        `expiresInMinutes must be an integer between 5 and ${MAX_DEVICE_RECOVERY_TOKEN_MINUTES}`,
      );
    }
    const device = await this.prisma.device.findUnique({
      where: { id: params.deviceId },
      select: {
        id: true,
        userId: true,
        fingerprintHash: true,
        eventSecret: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
    });
    if (!device || device.userId !== params.userId) {
      throw new BadRequestException('Device was not found for the requested user');
    }
    if (device.user.role !== 'developer') {
      throw new BadRequestException('Only developer extension devices can receive recovery tokens');
    }
    if (device.user.status === 'banned' || device.user.status === 'deleted') {
      throw new BadRequestException('Device recovery is unavailable for this account status');
    }
    if (!device.eventSecret) {
      throw new BadRequestException(
        'Legacy devices without a per-device secret can re-register without a support token',
      );
    }
    const recoverySupportToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashDeviceRecoveryToken(recoverySupportToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInMinutes * 60000);
    const reason = params.reason?.trim() || undefined;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.deviceRecoveryToken.updateMany({
        where: {
          userId: params.userId,
          deviceId: params.deviceId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      return tx.deviceRecoveryToken.create({
        data: {
          userId: params.userId,
          deviceId: params.deviceId,
          createdByUserId: params.reviewerId,
          tokenHash,
          reason,
          expiresAt,
        },
      });
    });
    await this.audit.log({
      actorId: params.reviewerId,
      actorRole: params.reviewerRole ?? 'admin',
      action: 'device_recovery_token_issued',
      targetType: 'device',
      targetId: params.deviceId,
      afterSnap: {
        userId: params.userId,
        tokenId: created.id,
        expiresAt: expiresAt.toISOString(),
        reason,
      },
    });
    return {
      tokenId: created.id,
      userId: params.userId,
      deviceId: params.deviceId,
      expiresAt,
      recoverySupportToken,
    };
  }

  // ── Recovery Debt Operations ──
  async getRecoveryDebtCases(params: {
    page?: number;
    limit?: number;
    minAmountMinor?: number;
    currency?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const minAmountMinor = params.minAmountMinor
      ? BigInt(Math.max(1, Number(params.minAmountMinor)))
      : 1n;
    const currency = normalizeOptionalCurrency(params.currency);
    const currencyFilter = currency ? { currency } : {};
    const [debitGroups, creditGroups] = await Promise.all([
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'debit', ...currencyFilter },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.earningsLedger.groupBy({
        by: ['userId', 'currency'],
        where: { status: 'confirmed', entryType: 'credit', ...currencyFilter },
        _sum: { amountMinor: true },
      }),
    ]);
    const creditByUserCurrency = new Map<string, bigint>();
    for (const credit of creditGroups) {
      creditByUserCurrency.set(
        `${credit.userId}:${credit.currency}`,
        credit._sum.amountMinor ?? 0n,
      );
    }
    const allDebtRows = debitGroups
      .map((debit) => {
        const debitMinor = debit._sum.amountMinor ?? 0n;
        const confirmedCreditMinor =
          creditByUserCurrency.get(`${debit.userId}:${debit.currency}`) ?? 0n;
        const outstandingDebtMinor =
          debitMinor > confirmedCreditMinor ? debitMinor - confirmedCreditMinor : 0n;
        return {
          userId: debit.userId,
          currency: debit.currency,
          confirmedDebitMinor: debitMinor,
          confirmedCreditMinor,
          outstandingDebtMinor,
          recoveryDebitEntryCount: debit._count._all,
        };
      })
      .filter((row) => row.outstandingDebtMinor >= minAmountMinor)
      .sort((a, b) =>
        a.outstandingDebtMinor > b.outstandingDebtMinor
          ? -1
          : a.outstandingDebtMinor < b.outstandingDebtMinor
            ? 1
            : a.userId.localeCompare(b.userId),
      );
    const total = allDebtRows.length;
    const rows = allDebtRows.slice((page - 1) * limit, page * limit);
    const userIds = Array.from(new Set(rows.map((row) => row.userId)));
    const currencies = Array.from(new Set(rows.map((row) => row.currency)));
    const [users, cases] =
      userIds.length > 0
        ? await Promise.all([
            this.prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, email: true, name: true, status: true, trustLevel: true },
            }),
            this.prisma.recoveryDebtCase.findMany({
              where: { userId: { in: userIds }, currency: { in: currencies } },
              orderBy: { updatedAt: 'desc' },
            }),
          ])
        : [[], []];
    const userById = new Map(users.map((user) => [user.id, user]));
    const latestCaseByUserCurrency = new Map<string, (typeof cases)[number]>();
    for (const debtCase of cases) {
      const key = recoveryDebtCaseKey(debtCase.userId, debtCase.currency);
      if (!latestCaseByUserCurrency.has(key)) {
        latestCaseByUserCurrency.set(key, debtCase);
      }
    }
    return {
      items: rows.map((row) => ({
        ...row,
        user: userById.get(row.userId) ?? null,
        latestCase:
          latestCaseByUserCurrency.get(recoveryDebtCaseKey(row.userId, row.currency)) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async openRecoveryDebtCase(params: {
    userId: string;
    reviewerId: string;
    reviewerRole?: string;
    status?: 'open' | 'in_collections';
    currency?: string;
    externalReference?: string;
    note?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (user.role !== 'developer') {
      throw new BadRequestException(
        'Recovery debt cases can only be opened for developer accounts',
      );
    }
    const requestedCurrency =
      normalizeOptionalCurrency(params.currency) ?? DEFAULT_RECOVERY_DEBT_CURRENCY;
    const debt = await this.getOutstandingRecoveryDebt(params.userId, requestedCurrency);
    if (debt.outstandingDebtMinor <= 0) {
      throw new BadRequestException('User has no outstanding recovery debt');
    }
    // Minimum-amount gate: don't open a collection case (with all its
    // operational overhead) for a trivial outstanding balance. Below this
    // threshold the debt is immaterial and not worth pursuing.
    const MIN_RECOVERY_DEBT_CASE_MINOR = 100; // $1.00
    if (debt.outstandingDebtMinor < MIN_RECOVERY_DEBT_CASE_MINOR) {
      throw new BadRequestException(
        `Outstanding recovery debt (${debt.outstandingDebtMinor} minor) is below the minimum threshold for opening a case`,
      );
    }
    const status =
      params.status === 'in_collections'
        ? RecoveryDebtCaseStatus.in_collections
        : RecoveryDebtCaseStatus.open;
    const note = sanitizeOptionalString(params.note);
    const externalReference = sanitizeOptionalString(params.externalReference);
    const debtCase = await this.prisma
      .$transaction(async (tx) => {
        const existing = await tx.recoveryDebtCase.findFirst({
          where: {
            userId: params.userId,
            currency: debt.currency,
            status: { in: ACTIVE_RECOVERY_DEBT_CASE_STATUSES },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) {
          // Fail-closed pre-check against the recovery-debt state machine (P2.2):
          // re-classifying an active case (open ↔ in_collections) is allowed.
          validateRecoveryDebtTransition(existing.status, status);
          return tx.recoveryDebtCase.update({
            where: { id: existing.id },
            data: {
              status,
              amountMinor: debt.outstandingDebtMinor,
              currency: debt.currency,
              externalReference,
              note,
              openedByUserId: params.reviewerId,
              resolvedByUserId: null,
              resolvedAt: null,
            },
          });
        }
        return tx.recoveryDebtCase.create({
          data: {
            userId: params.userId,
            status,
            amountMinor: debt.outstandingDebtMinor,
            currency: debt.currency,
            externalReference,
            note,
            openedByUserId: params.reviewerId,
          },
        });
      })
      .catch((err: unknown) => {
        if (getErrorCode(err) === 'P2002') {
          throw new BadRequestException(
            'An active recovery debt case already exists for this user and currency. Reload and update the existing case.',
          );
        }
        throw err;
      });
    await this.audit.log({
      actorId: params.reviewerId,
      actorRole: params.reviewerRole ?? 'admin',
      action: 'recovery_debt_case_opened',
      targetType: 'recovery_debt_case',
      targetId: debtCase.id,
      afterSnap: {
        userId: params.userId,
        status,
        outstandingDebtMinor: String(debt.outstandingDebtMinor),
        currency: debt.currency,
        externalReference,
      },
    });
    return { case: debtCase, debt };
  }

  async resolveRecoveryDebtCase(params: {
    caseId: string;
    reviewerId: string;
    reviewerRole?: string;
    status: 'recovered' | 'written_off' | 'closed';
    externalReference?: string;
    note?: string;
  }) {
    const terminalStatus = toTerminalRecoveryDebtStatus(params.status);
    const note = sanitizeOptionalString(params.note);
    const externalReference = sanitizeOptionalString(params.externalReference);
    const now = new Date();
    const existing = await this.prisma.recoveryDebtCase.findUnique({
      where: { id: params.caseId },
    });
    if (!existing) throw new BadRequestException('Recovery debt case not found');
    // Fail-closed pre-check against the recovery-debt state machine (P2.2):
    // only an ACTIVE case may be resolved to a terminal status.
    validateRecoveryDebtTransition(existing.status, terminalStatus);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.recoveryDebtCase.updateMany({
        where: {
          id: params.caseId,
          status: { in: ACTIVE_RECOVERY_DEBT_CASE_STATUSES },
        },
        data: {
          status: terminalStatus,
          externalReference,
          note,
          resolvedByUserId: params.reviewerId,
          resolvedAt: now,
        },
      });
      if (claimed.count === 0) {
        const current = await tx.recoveryDebtCase.findUnique({
          where: { id: params.caseId },
          select: { status: true },
        });
        throw new BadRequestException(
          current
            ? `Recovery debt case cannot be resolved from status '${current.status}'`
            : 'Recovery debt case not found',
        );
      }
      return tx.recoveryDebtCase.findUnique({ where: { id: params.caseId } });
    });
    const debt = await this.getOutstandingRecoveryDebt(existing.userId, existing.currency);
    await this.audit.log({
      actorId: params.reviewerId,
      actorRole: params.reviewerRole ?? 'admin',
      action: 'recovery_debt_case_resolved',
      targetType: 'recovery_debt_case',
      targetId: params.caseId,
      beforeSnap: { status: existing.status, amountMinor: String(existing.amountMinor) },
      afterSnap: {
        status: terminalStatus,
        userId: existing.userId,
        currentOutstandingDebtMinor: String(debt.outstandingDebtMinor),
        currency: debt.currency,
        externalReference,
      },
    });
    return { case: updated, debt };
  }

  async getOutstandingRecoveryDebt(userId: string, currency = DEFAULT_RECOVERY_DEBT_CURRENCY) {
    const [confirmedDebits, confirmedCredits] = await Promise.all([
      this.prisma.earningsLedger.aggregate({
        where: { userId, currency, status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      }),
      this.prisma.earningsLedger.aggregate({
        where: { userId, currency, status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      }),
    ]);
    const confirmedDebitMinor = confirmedDebits._sum.amountMinor ?? 0n;
    const confirmedCreditMinor = confirmedCredits._sum.amountMinor ?? 0n;
    return {
      userId,
      currency,
      confirmedDebitMinor,
      confirmedCreditMinor,
      outstandingDebtMinor:
        confirmedDebitMinor > confirmedCreditMinor
          ? confirmedDebitMinor - confirmedCreditMinor
          : 0n,
    };
  }
}

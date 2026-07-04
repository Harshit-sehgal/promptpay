import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { LedgerService } from './ledger.service';
import { LedgerHistoryQueryDto } from './dto';

@Controller('ledger')
@UseGuards(JwtAuthGuard)
@AllowApiKey()
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  /** Developer: own earnings balance only */
  @Get('balance')
  @RequiredScopes('ledger:read')
  getBalance(@CurrentUser('id') userId: string) {
    return Promise.all([
      this.ledgerService.getAvailableBalance(userId),
      this.ledgerService.getPendingBalance(userId),
      this.ledgerService.getTotalEarnings(userId),
      this.ledgerService.getPaidOutTotal(userId),
    ]).then(([available, pending, total, paidOut]) => ({
      available,
      pending,
      total,
      paidOut,
    }));
  }

  /** Developer: own earnings breakdown only */
  @Get('breakdown')
  @RequiredScopes('ledger:read')
  getBreakdown(@CurrentUser('id') userId: string) {
    return this.ledgerService.getEarningsBreakdown(userId);
  }

  /** Developer: own earnings history only. Ignores ledgerKind if set (no privilege escalation). */
  @Get('history')
  @RequiredScopes('ledger:read')
  getHistory(
    @CurrentUser('id') userId: string,
    @Query() query: LedgerHistoryQueryDto,
  ) {
    // Force ledgerKind to 'earnings' — developers can only see their own earnings.
    // Platform/advertiser ledgers are exposed only via /admin/ledger/* endpoints.
    return this.ledgerService.getEarningsHistory(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
      { ledgerKind: 'earnings', status: query.status },
    );
  }

  /** Admin: platform-wide ledger history (all ledger kinds) */
  @Get('admin/history')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  getAdminHistory(
    @Query() query: LedgerHistoryQueryDto,
  ) {
    return this.ledgerService.getHistoryForAdmin(
      { ledgerKind: query.ledgerKind, status: query.status },
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /** Admin: platform-wide breakdown */
  @Get('admin/breakdown')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  getAdminBreakdown() {
    return this.ledgerService.getPlatformBreakdown();
  }
}

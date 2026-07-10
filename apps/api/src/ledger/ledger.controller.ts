import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { LedgerHistoryQueryDto } from './dto';
import { LedgerService } from './ledger.service';

@ApiTags('Ledger')
@Controller('ledger')
@UseGuards(JwtAuthGuard)
@AllowApiKey()
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  /** Developer: own earnings balance only */
  @ApiOperation({ summary: 'Get earnings balance' })
  @Get('balance')
  @UseGuards(RolesGuard)
  @Roles('developer')
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
  @ApiOperation({ summary: 'Get earnings breakdown' })
  @Get('breakdown')
  @UseGuards(RolesGuard)
  @Roles('developer')
  @RequiredScopes('ledger:read')
  getBreakdown(@CurrentUser('id') userId: string) {
    return this.ledgerService.getEarningsBreakdown(userId);
  }

  /** Developer: own earnings history only. Ignores ledgerKind if set (no privilege escalation). */
  @ApiOperation({ summary: 'Get earnings history' })
  @Get('history')
  @UseGuards(RolesGuard)
  @Roles('developer')
  @RequiredScopes('ledger:read')
  getHistory(@CurrentUser('id') userId: string, @Query() query: LedgerHistoryQueryDto) {
    // Force ledgerKind to 'earnings' — developers can only see their own earnings.
    // Platform/advertiser ledgers are exposed only via /admin/ledger/* endpoints.
    return this.ledgerService.getEarningsHistory(userId, query.page ?? 1, query.limit ?? 20, {
      ledgerKind: 'earnings',
      status: query.status,
    });
  }

  /** Admin: platform-wide ledger history (all ledger kinds) */
  @ApiOperation({ summary: 'Get admin ledger history' })
  @Get('admin/history')
  @UseGuards(RolesGuard, RejectApiKeyGuard)
  @Roles('admin', 'super_admin')
  getAdminHistory(@Query() query: LedgerHistoryQueryDto) {
    return this.ledgerService.getHistoryForAdmin(
      { ledgerKind: query.ledgerKind, status: query.status },
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /** Admin: platform-wide breakdown */
  @ApiOperation({ summary: 'Get admin ledger breakdown' })
  @Get('admin/breakdown')
  @UseGuards(RolesGuard, RejectApiKeyGuard)
  @Roles('admin', 'super_admin')
  getAdminBreakdown() {
    return this.ledgerService.getPlatformBreakdown();
  }
}

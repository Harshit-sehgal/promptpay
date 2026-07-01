import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { LedgerService } from './ledger.service';
import { LedgerHistoryQueryDto } from './dto';

@Controller('ledger')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private ledgerService: LedgerService) {}

  @Get('balance')
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

  @Get('breakdown')
  getBreakdown(@CurrentUser('id') userId: string) {
    return this.ledgerService.getEarningsBreakdown(userId);
  }

  @Get('history')
  getHistory(
    @CurrentUser('id') userId: string,
    @Query() query: LedgerHistoryQueryDto,
  ) {
    return this.ledgerService.getEarningsHistory(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
      { ledgerKind: query.ledgerKind, status: query.status },
    );
  }
}

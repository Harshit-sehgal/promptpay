import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { PayoutService } from './payout.service';
import {
  AddPayoutMethodDto,
  RequestPayoutDto,
  PayoutHistoryQueryDto,
} from './dto';

@Controller('payout')
@UseGuards(JwtAuthGuard, RolesGuard)
@AllowApiKey()
export class PayoutController {
  constructor(private service: PayoutService) {}

  @Post('method')
  @Roles('developer')
  @RequiredScopes('advertiser:write')
  addPayoutMethod(
    @CurrentUser('id') userId: string,
    @Body() dto: AddPayoutMethodDto,
  ) {
    return this.service.addPayoutMethod(userId, dto);
  }

  @Get('info')
  @Roles('developer')
  @RequiredScopes('advertiser:read')
  getPayoutInfo(@CurrentUser('id') userId: string) {
    return this.service.getPayoutInfo(userId);
  }

  @Post('request')
  @Roles('developer')
  @RequiredScopes('advertiser:write')
  requestPayout(
    @CurrentUser('id') userId: string,
    @Body() dto: RequestPayoutDto,
  ) {
    return this.service.requestPayout(userId, {
      payoutAccountId: dto.payoutAccountId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      earningsEntryIds: dto.earningsEntryIds,
    });
  }

  @Get('available')
  @Roles('developer')
  @RequiredScopes('ledger:read')
  getAvailableForPayout(@CurrentUser('id') userId: string) {
    return this.service.getAvailableForPayout(userId);
  }

  @Get('history')
  @Roles('developer')
  @RequiredScopes('ledger:read')
  getPayoutHistory(
    @CurrentUser('id') userId: string,
    @Query() query: PayoutHistoryQueryDto,
  ) {
    return this.service.getPayoutHistory(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }
}

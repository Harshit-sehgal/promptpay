import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Audit, AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { AddPayoutMethodDto, PayoutHistoryQueryDto, RequestPayoutDto } from './dto';
import { PayoutService } from './payout.service';

@ApiTags('Payout')
@Controller('payout')
@UseGuards(JwtAuthGuard, RolesGuard)
@AllowApiKey()
export class PayoutController {
  constructor(private service: PayoutService) {}

  @ApiOperation({ summary: 'Get runtime payout provider availability' })
  @Get('providers')
  @UseGuards(RejectApiKeyGuard)
  @Roles('developer')
  @RequiredScopes('payout:read')
  async getPayoutProviderAvailability() {
    return this.service.getPayoutProviderAvailability();
  }

  @ApiOperation({ summary: 'Add payout method' })
  @Post('method')
  @UseGuards(RejectApiKeyGuard)
  @Roles('developer')
  @RequiredScopes('payout:write')
  addPayoutMethod(@CurrentUser('id') userId: string, @Body() dto: AddPayoutMethodDto) {
    return this.service.addPayoutMethod(userId, dto);
  }

  @ApiOperation({ summary: 'Get payout info' })
  @Get('info')
  @UseGuards(RejectApiKeyGuard)
  @Roles('developer')
  @RequiredScopes('payout:read')
  getPayoutInfo(@CurrentUser('id') userId: string) {
    return this.service.getPayoutInfo(userId);
  }

  @ApiOperation({ summary: 'Request payout' })
  @Post('request')
  @Audit('request_payout', 'payout')
  @UseInterceptors(AuditInterceptor)
  @UseGuards(RejectApiKeyGuard)
  @Roles('developer')
  @RequiredScopes('payout:write')
  requestPayout(@CurrentUser('id') userId: string, @Body() dto: RequestPayoutDto) {
    return this.service.requestPayout(userId, {
      payoutAccountId: dto.payoutAccountId,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      earningsEntryIds: dto.earningsEntryIds,
    });
  }

  @ApiOperation({ summary: 'Get available balance for payout' })
  @Get('available')
  @Roles('developer')
  @RequiredScopes('ledger:read')
  getAvailableForPayout(@CurrentUser('id') userId: string, @Query() query: PayoutHistoryQueryDto) {
    return this.service.getAvailableForPayout(userId, {
      page: query.page !== undefined ? Number(query.page) : undefined,
      limit: query.limit !== undefined ? Number(query.limit) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get payout history' })
  @Get('history')
  @UseGuards(RejectApiKeyGuard)
  @Roles('developer')
  @RequiredScopes('ledger:read')
  getPayoutHistory(@CurrentUser('id') userId: string, @Query() query: PayoutHistoryQueryDto) {
    return this.service.getPayoutHistory(userId, query.page ?? 1, query.limit ?? 20);
  }
}

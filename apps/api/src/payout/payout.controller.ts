import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { PayoutService } from './payout.service';
import {
  AddPayoutMethodDto,
  RequestPayoutDto,
  PayoutHistoryQueryDto,
} from './dto';

@Controller('payout')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutController {
  constructor(private service: PayoutService) {}

  @Post('method')
  @Roles('developer')
  addPayoutMethod(
    @CurrentUser('id') userId: string,
    @Body() dto: AddPayoutMethodDto,
  ) {
    return this.service.addPayoutMethod(userId, dto);
  }

  @Get('info')
  @Roles('developer')
  getPayoutInfo(@CurrentUser('id') userId: string) {
    return this.service.getPayoutInfo(userId);
  }

  @Post('request')
  @Roles('developer')
  requestPayout(
    @CurrentUser('id') userId: string,
    @Body() dto: RequestPayoutDto,
  ) {
    return this.service.requestPayout(userId, dto);
  }

  @Get('history')
  @Roles('developer')
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

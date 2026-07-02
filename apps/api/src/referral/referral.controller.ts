import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { ReferralService } from './referral.service';
import { ApplyReferralDto } from './dto';

@Controller('referral')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class ReferralController {
  constructor(private service: ReferralService) {}

  /** Get user's referral info (code, count, link, rewards) */
  @Get()
  getReferralInfo(@CurrentUser('id') userId: string) {
    return this.service.getReferralInfo(userId);
  }

  /** Apply a referral code (for users who signed up without one) */
  @Post('apply')
  applyReferralCode(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyReferralDto,
  ) {
    return this.service.applyReferralCode(userId, dto.code);
  }

  /** Get referral history */
  @Get('history')
  getReferralHistory(@CurrentUser('id') userId: string) {
    return this.service.getReferralHistory(userId);
  }
}
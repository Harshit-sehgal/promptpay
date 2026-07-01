import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/decorators';
import { FraudService } from './fraud.service';

@Controller('fraud')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FraudController {
  constructor(private fraudService: FraudService) {}

  @Get('flags')
  @Roles('admin', 'support', 'super_admin')
  getOpenFlags(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('severity') severity?: string,
  ) {
    return this.fraudService.getOpenFlags(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      severity,
    );
  }

  @Get('stats')
  @Roles('admin', 'support', 'super_admin')
  getFlagStats() {
    return this.fraudService.getFlagStats();
  }

  @Post('flags/:id/resolve')
  @Roles('admin', 'super_admin')
  resolveFlag(
    @Param('id') flagId: string,
    @CurrentUser('id') reviewerId: string,
    @Body() body: { isValid: boolean; reviewNote?: string },
  ) {
    return this.fraudService.resolveFlag(flagId, reviewerId, body.isValid, body.reviewNote);
  }

  @Post('compute-trust/:userId')
  @Roles('admin', 'super_admin')
  computeTrustScore(@Param('userId') userId: string) {
    return this.fraudService.computeTrustScore(userId);
  }
}

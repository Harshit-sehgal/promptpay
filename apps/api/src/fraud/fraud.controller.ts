import { Controller, Get, Post, Param, Body, Query, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Roles } from '../common/decorators';
import { CurrentUser } from '../common/decorators';
import { FraudService } from './fraud.service';
import { ResolveFlagDto } from './dto/resolve-flag.dto';

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

  // Apply the admin AuditInterceptor so this non-/admin route is also audited
  // when it triggers a money-mutating resolveFlag call. The interceptor only
  // fires on /admin/* by default — opt-in needed here. Also include the
  // `:id` as `id` in params so the interceptor parses it correctly.
  @Post('flags/:id/resolve')
  @Roles('admin', 'super_admin')
  @UseInterceptors(AuditInterceptor)
  resolveFlag(
    @Param('id', ParseUUIDPipe) flagId: string,
    @CurrentUser('id') reviewerId: string,
    @Body() dto: ResolveFlagDto,
  ) {
    // `decision==='confirmed'` maps to isValid=true (earnings reversed);
    // `'invalid'` maps to false-positive (held earnings released).
    // Both branches are money-mutating — proper DTO validation closes the
    // inline-body bypass (a truthy string like 'yes' previously reached
    // `resolveFlag` unchanged because inline types carry no validation
    // metadata for class-validator).
    const isValid = dto.decision === 'confirmed';
    return this.fraudService.resolveFlag(flagId, reviewerId, isValid, dto.note);
  }

  @Post('compute-trust/:userId')
  @Roles('admin', 'super_admin')
  computeTrustScore(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.fraudService.computeTrustScore(userId);
  }
}

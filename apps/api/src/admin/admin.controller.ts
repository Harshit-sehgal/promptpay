import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { Roles, CurrentUser } from '../common/decorators';
import { AdminService } from './admin.service';
import {
  ApproveCampaignDto,
  RejectCampaignDto,
  ApprovePayoutDto,
  RejectPayoutDto,
  MarkPayoutPaidDto,
  ResolveFraudFlagDto,
  FraudFlagsQueryDto,
  UsersQueryDto,
  AuditLogQueryDto,
} from './dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'super_admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @Get('overview') getOverview() {
    return this.service.getOverview();
  }

  @Get('users')
  getUsers(@Query() query: UsersQueryDto) {
    return this.service.getUsers(query);
  }

  @Get('campaigns/pending') getPendingCampaigns() {
    return this.service.getPendingCampaigns();
  }

  @Post('campaigns/:id/approve')
  approveCampaign(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApproveCampaignDto,
  ) {
    return this.service.approveCampaign(id, userId, dto.reason);
  }

  @Post('campaigns/:id/reject')
  rejectCampaign(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectCampaignDto,
  ) {
    return this.service.rejectCampaign(id, userId, dto.reason);
  }

  @Get('payouts/pending') getPendingPayouts() {
    return this.service.getPendingPayouts();
  }

  @Post('payouts/:id/approve')
  approvePayout(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApprovePayoutDto,
  ) {
    return this.service.approvePayout(id, userId, dto.note);
  }

  @Post('payouts/:id/reject')
  rejectPayout(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectPayoutDto,
  ) {
    return this.service.rejectPayout(id, userId, dto.reason);
  }

  @Post('payouts/:id/mark-paid')
  markPayoutPaid(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MarkPayoutPaidDto,
  ) {
    return this.service.markPayoutPaid(id, dto);
  }

  @Get('fraud')
  getFraudFlags(@Query() query: FraudFlagsQueryDto) {
    return this.service.getFraudFlags(query);
  }

  @Post('fraud/:id/resolve')
  resolveFraudFlag(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ResolveFraudFlagDto,
  ) {
    return this.service.resolveFraudFlag(id, userId, dto.decision, dto.note);
  }

  @Get('audit-log')
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.service.getAuditLog(query);
  }
}

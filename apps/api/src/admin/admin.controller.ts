import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { AdminService } from './admin.service';
import {
  AdminDevicesQueryDto,
  ApproveCampaignDto,
  ApprovePayoutDto,
  AuditLogQueryDto,
  FraudFlagsQueryDto,
  IssueDeviceRecoveryTokenDto,
  MarkPayoutPaidDto,
  OpenRecoveryDebtCaseDto,
  PayoutAccountVerifyDto,
  RecoveryDebtCasesQueryDto,
  RejectCampaignDto,
  RejectPayoutDto,
  ResolveFraudFlagDto,
  ResolveRecoveryDebtCaseDto,
  ToggleToolIntegrationDto,
  UsersQueryDto,
  WebhookEventsQueryDto,
} from './dto';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'super_admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @ApiOperation({ summary: 'Get admin overview' })
  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }

  @ApiOperation({ summary: 'Get money integrity report' })
  @Get('money-integrity')
  getMoneyIntegrityReport() {
    return this.service.getMoneyIntegrityReport();
  }

  @ApiOperation({ summary: 'Get admin metrics' })
  @Get('metrics')
  getMetrics(@Query('days') days?: string) {
    return this.service.getMetrics(days ? parseInt(days, 10) : 30);
  }

  @ApiOperation({ summary: 'Get users' })
  @Get('users')
  getUsers(@Query() query: UsersQueryDto) {
    return this.service.getUsers(query);
  }

  @ApiOperation({ summary: 'Get pending campaigns' })
  @Get('campaigns/pending')
  getPendingCampaigns(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.service.getPendingCampaigns({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: (status as 'submitted' | 'approved' | undefined) ?? undefined,
    });
  }

  @ApiOperation({ summary: 'Approve campaign' })
  @Post('campaigns/:id/approve')
  approveCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApproveCampaignDto,
  ) {
    return this.service.approveCampaign(id, userId, dto.reason);
  }

  @ApiOperation({ summary: 'Reject campaign' })
  @Post('campaigns/:id/reject')
  rejectCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectCampaignDto,
  ) {
    return this.service.rejectCampaign(id, userId, dto.reason);
  }

  @ApiOperation({ summary: 'Get pending payouts' })
  @Get('payouts/pending')
  getPendingPayouts() {
    return this.service.getPendingPayouts();
  }

  @ApiOperation({ summary: 'Approve payout' })
  @Post('payouts/:id/approve')
  approvePayout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApprovePayoutDto,
  ) {
    return this.service.approvePayout(id, userId, dto.note, dto.approvedAmountMinor);
  }

  @ApiOperation({ summary: 'Reject payout' })
  @Post('payouts/:id/reject')
  rejectPayout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectPayoutDto,
  ) {
    return this.service.rejectPayout(id, userId, dto.reason);
  }

  @ApiOperation({ summary: 'Process payout' })
  @Post('payouts/:id/process')
  processPayout(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.processPayout(id);
  }

  @ApiOperation({ summary: 'Mark payout paid' })
  @Post('payouts/:id/mark-paid')
  markPayoutPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MarkPayoutPaidDto,
  ) {
    return this.service.markPayoutPaid(id, dto);
  }

  @ApiOperation({ summary: 'Get fraud flags' })
  @Get('fraud')
  getFraudFlags(@Query() query: FraudFlagsQueryDto) {
    return this.service.getFraudFlags(query);
  }

  @ApiOperation({ summary: 'Get fraud stats' })
  @Get('fraud/stats')
  getFraudStats() {
    return this.service.getFraudStats();
  }

  @ApiOperation({ summary: 'Resolve fraud flag' })
  @Post('fraud/:id/resolve')
  resolveFraudFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ResolveFraudFlagDto,
  ) {
    return this.service.resolveFraudFlag(id, userId, dto.decision, dto.note);
  }

  @ApiOperation({ summary: 'Compute trust score' })
  @Post('fraud/compute-trust/:userId')
  computeTrustScore(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.service.recomputeTrustScore(userId);
  }

  @ApiOperation({ summary: 'Get audit log' })
  @Get('audit-log')
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.service.getAuditLog(query);
  }

  @ApiOperation({ summary: 'Erase user' })
  @Post('users/:id/erase')
  eraseUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
  ) {
    return this.service.eraseUser(actorId, actorRole, id);
  }

  @ApiOperation({ summary: 'Set user status' })
  @Post('users/:id/status')
  setUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body('status') status: string,
  ) {
    return this.service.setUserStatus(actorId, actorRole, id, status);
  }

  // ── Device Recovery ──

  @ApiOperation({ summary: 'Get devices' })
  @Get('devices')
  @Roles('admin', 'support', 'super_admin')
  getDevices(@Query() query: AdminDevicesQueryDto) {
    return this.service.getDevices(query);
  }

  @ApiOperation({ summary: 'Issue device recovery token' })
  @Post('devices/:id/recovery-token')
  @Roles('admin', 'support', 'super_admin')
  issueDeviceRecoveryToken(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: IssueDeviceRecoveryTokenDto,
  ) {
    return this.service.issueDeviceRecoveryToken({
      deviceId: id,
      userId: dto.userId,
      reviewerId,
      reviewerRole,
      reason: dto.reason,
      expiresInMinutes: dto.expiresInMinutes,
    });
  }

  // ── Recovery Debt Operations ──

  @ApiOperation({ summary: 'Get recovery debt cases' })
  @Get('recovery-debt')
  getRecoveryDebtCases(@Query() query: RecoveryDebtCasesQueryDto) {
    return this.service.getRecoveryDebtCases(query);
  }

  @ApiOperation({ summary: 'Open recovery debt case' })
  @Post('recovery-debt/users/:userId/open')
  openRecoveryDebtCase(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: OpenRecoveryDebtCaseDto,
  ) {
    return this.service.openRecoveryDebtCase({
      userId,
      reviewerId,
      reviewerRole,
      status: dto.status,
      currency: dto.currency,
      externalReference: dto.externalReference,
      note: dto.note,
    });
  }

  @ApiOperation({ summary: 'Resolve recovery debt case' })
  @Post('recovery-debt/cases/:id/resolve')
  resolveRecoveryDebtCase(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: ResolveRecoveryDebtCaseDto,
  ) {
    return this.service.resolveRecoveryDebtCase({
      caseId: id,
      reviewerId,
      reviewerRole,
      status: dto.status,
      externalReference: dto.externalReference,
      note: dto.note,
    });
  }

  // ── Tool Integrations ──

  @ApiOperation({ summary: 'Get tool integrations' })
  @Get('tools')
  getToolIntegrations() {
    return this.service.getToolIntegrations();
  }

  @ApiOperation({ summary: 'Toggle tool integration' })
  @Post('tools/:slug/toggle')
  toggleToolIntegration(@Param('slug') slug: string, @Body() dto: ToggleToolIntegrationDto) {
    return this.service.toggleToolIntegration(slug, dto.isActive === 'true');
  }

  // ── Webhook Events ──

  @ApiOperation({ summary: 'Get webhook events' })
  @Get('webhooks')
  getWebhookEvents(@Query() query: WebhookEventsQueryDto) {
    return this.service.getWebhookEvents(query);
  }

  // ── Payout account verification ─

  @ApiOperation({ summary: 'Verify payout account' })
  @Post('payout-accounts/:id/verify')
  @Roles('admin', 'support', 'super_admin')
  verifyPayoutAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: PayoutAccountVerifyDto,
  ) {
    return this.service.setPayoutAccountVerified(
      reviewerId,
      reviewerRole,
      id,
      dto.verified,
      dto.reason,
    );
  }

  // ── Archive Refunds ──

  @ApiOperation({ summary: 'Get pending archive refunds' })
  @Get('refunds/archive/pending')
  getPendingArchiveRefunds() {
    return this.service.getPendingArchiveRefunds();
  }

  /**
   * Confirm an archive refund obligation row after the admin manually issues
   * the Stripe refund. The body carries the ledger entry id and the Stripe
   * refund payment_intent id so the platform books the cash outflow.
   */
  @ApiOperation({ summary: 'Confirm archive refund' })
  @Post('refunds/archive/:id/confirm')
  confirmArchiveRefund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stripeRefundPaymentIntentId') stripeRefundPaymentIntentId: string,
  ) {
    if (!stripeRefundPaymentIntentId) {
      throw new BadRequestException('stripeRefundPaymentIntentId is required');
    }
    return this.service.confirmArchiveRefund({
      entryId: id,
      stripeRefundPaymentIntentId,
    });
  }
}

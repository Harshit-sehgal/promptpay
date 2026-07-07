import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, Query, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
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
  IssueDeviceRecoveryTokenDto,
  RecoveryDebtCasesQueryDto,
  OpenRecoveryDebtCaseDto,
  ResolveRecoveryDebtCaseDto,
  ToggleToolIntegrationDto,
  WebhookEventsQueryDto,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApproveCampaignDto,
  ) {
    return this.service.approveCampaign(id, userId, dto.reason);
  }

  @Post('campaigns/:id/reject')
  rejectCampaign(
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ApprovePayoutDto,
  ) {
    return this.service.approvePayout(id, userId, dto.note, dto.approvedAmountMinor);
  }

  @Post('payouts/:id/reject')
  rejectPayout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: RejectPayoutDto,
  ) {
    return this.service.rejectPayout(id, userId, dto.reason);
  }

  @Post('payouts/:id/mark-paid')
  markPayoutPaid(
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ResolveFraudFlagDto,
  ) {
    return this.service.resolveFraudFlag(id, userId, dto.decision, dto.note);
  }

  @Get('audit-log')
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.service.getAuditLog(query);
  }

  // ── Device Recovery ──

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

  @Get('recovery-debt')
  getRecoveryDebtCases(@Query() query: RecoveryDebtCasesQueryDto) {
    return this.service.getRecoveryDebtCases(query);
  }

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

  @Get('tools')
  getToolIntegrations() {
    return this.service.getToolIntegrations();
  }

  @Post('tools/:slug/toggle')
  toggleToolIntegration(
    @Param('slug') slug: string,
    @Body() dto: ToggleToolIntegrationDto,
  ) {
    return this.service.toggleToolIntegration(slug, dto.isActive === 'true');
  }

  // ── Webhook Events ──

  @Get('webhooks')
  getWebhookEvents(@Query() query: WebhookEventsQueryDto) {
    return this.service.getWebhookEvents(query);
  }

  // ── Archive Refunds ──

  /**
   * Confirm an archive refund obligation row after the admin manually issues
   * the Stripe refund. The body carries the ledger entry id and the Stripe
   * refund payment_intent id so the platform books the cash outflow.
   */
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

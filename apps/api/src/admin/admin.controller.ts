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

import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../common/decorators';
import { AdminMfaStepUpGuard } from '../common/guards/admin-mfa-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { AdminService } from './admin.service';
import {
  AdminDevicesQueryDto,
  AdminMetricsQueryDto,
  ApproveCampaignDto,
  ApprovePayoutDto,
  ArchiveRefundQueueQueryDto,
  AuditLogQueryDto,
  EscalateFraudFlagDto,
  FraudFlagsQueryDto,
  IssueDeviceRecoveryTokenDto,
  MarkPayoutPaidDto,
  OpenRecoveryDebtCaseDto,
  PayoutAccountFreezeDto,
  PayoutAccountVerifyDto,
  RecoveryDebtCasesQueryDto,
  RejectCampaignDto,
  RejectPayoutDto,
  ReleasePayoutFenceDto,
  ResolveDeadLetterDto,
  ResolveFraudFlagDto,
  ResolveRecoveryDebtCaseDto,
  ToggleRuntimeConfigDto,
  ToggleToolIntegrationDto,
  UpdateRuntimeConfigDto,
  UsersQueryDto,
  WebhookEventsQueryDto,
} from './dto';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, AdminMfaStepUpGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'super_admin')
export class AdminController {
  constructor(
    private service: AdminService,
    private runtimeConfig: RuntimeConfigService,
    private audit: AuditService,
  ) {}

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
  getMetrics(@Query() query: AdminMetricsQueryDto) {
    return this.service.getMetrics(query.days, query.currency);
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
    return this.service.approvePayout(
      id,
      userId,
      dto.note,
      dto.approvedAmountMinor !== undefined ? BigInt(dto.approvedAmountMinor) : undefined,
    );
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
    return this.service.markPayoutPaid(id, {
      ...dto,
      amountMinor: BigInt(dto.amountMinor),
    });
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

  @ApiOperation({ summary: 'Escalate fraud flag for senior review' })
  @Post('fraud/:id/escalate')
  escalateFraudFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: EscalateFraudFlagDto,
  ) {
    return this.service.escalateFraudFlag(id, userId, dto.note);
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

  @ApiOperation({ summary: 'Freeze payout account' })
  @Post('payout-accounts/:id/freeze')
  @Roles('admin', 'support', 'super_admin')
  freezePayoutAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: PayoutAccountFreezeDto,
  ) {
    return this.service.freezePayoutAccount(reviewerId, reviewerRole, id, dto.reason);
  }

  @ApiOperation({ summary: 'Unfreeze payout account' })
  @Post('payout-accounts/:id/unfreeze')
  @Roles('admin', 'support', 'super_admin')
  unfreezePayoutAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: PayoutAccountFreezeDto,
  ) {
    return this.service.unfreezePayoutAccount(reviewerId, reviewerRole, id, dto.reason);
  }

  @ApiOperation({ summary: 'List payout accounts with an active provider-initiation fence' })
  @Get('payout-accounts/fenced')
  @Roles('admin', 'support', 'super_admin')
  getFencedAccounts(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getFencedAccounts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @ApiOperation({ summary: 'Release a payout account provider-initiation fence' })
  @Post('payout-accounts/:id/release-fence')
  @Roles('admin', 'support', 'super_admin')
  releasePayoutFence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') reviewerId: string,
    @CurrentUser('role') reviewerRole: string,
    @Body() dto: ReleasePayoutFenceDto,
  ) {
    return this.service.releasePayoutFence({
      payoutAccountId: id,
      reviewerId,
      reviewerRole,
      reason: dto.reason,
      providerTxId: dto.providerTxId,
      resolution: dto.resolution,
      secondApproverId: dto.secondApproverId,
    });
  }

  @ApiOperation({ summary: 'List audit outbox dead-letter rows (failed audit events)' })
  @Get('audit-outbox/dead-letter')
  @Roles('admin', 'support', 'super_admin')
  listDeadLetter(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.audit.listDeadLetter({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @ApiOperation({ summary: 'Requeue an audit outbox dead-letter row for another drain attempt' })
  @Post('audit-outbox/dead-letter/:id/retry')
  @Roles('admin', 'support', 'super_admin')
  async retryDeadLetter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
  ) {
    await this.audit.retryDeadLetter(id, { actorId, actorRole });
    return { ok: true };
  }

  @ApiOperation({ summary: 'Resolve an audit outbox dead-letter row' })
  @Post('audit-outbox/dead-letter/:id/resolve')
  @Roles('admin', 'support', 'super_admin')
  async resolveDeadLetter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: ResolveDeadLetterDto,
  ) {
    await this.audit.resolveDeadLetter(id, {
      reason: dto.reason,
      actorId,
      actorRole,
    });
    return { ok: true };
  }

  // ── Archive Refunds ──

  @ApiOperation({ summary: 'Get pending archive refunds' })
  @Get('refunds/archive/pending')
  getPendingArchiveRefunds(@Query() query: ArchiveRefundQueueQueryDto) {
    return this.service.getPendingArchiveRefunds(query);
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

  // ── Runtime Kill Switches ──

  @ApiOperation({ summary: 'List runtime kill switches' })
  @Get('settings')
  getRuntimeSettings() {
    return this.runtimeConfig.getAll();
  }

  @ApiOperation({ summary: 'Update a runtime setting (raw JSON value)' })
  @Post('settings/:scope/:target')
  updateRuntimeSetting(
    @Param('scope') scope: string,
    @Param('target') target: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: UpdateRuntimeConfigDto,
  ) {
    return this.runtimeConfig.setRaw(scope, target, dto.value, actorId, dto.reason);
  }

  @ApiOperation({ summary: 'Toggle a runtime boolean switch' })
  @Post('settings/:scope/:target/toggle')
  toggleRuntimeSetting(
    @Param('scope') scope: string,
    @Param('target') target: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: ToggleRuntimeConfigDto,
  ) {
    return this.runtimeConfig.setBoolean({ scope, target }, dto.enabled, actorId, dto.reason);
  }
}

import { Request } from 'express';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { depositMinimumMinor } from '@waitlayer/shared';

import { CurrentUser, Roles } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Audit, AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { DeleteAccountDto } from '../developer/dto';
import { StripeProvider } from '../payout/providers';
import { AdvertiserService } from './advertiser.service';
import {
  CreateCampaignDto,
  CreateDepositSessionDto,
  CreateProfileDto,
  UpdateCampaignDto,
} from './dto';

/**
 * The advertiser routes accept either a JWT (acting user) or an API key
 * (machine-to-machine). When the request is API-key authenticated the
 * resolved credentials are on `request.apiKey`; when JWT-authenticated they
 * are on `request.user`. Helpers below resolve the advertiserId from either
 * source — keeping handler bodies free of auth-shape branching.
 */
function resolveApiContext(req: {
  user?: { id?: string; sub?: string };
  apiKey?: { scopes: string[]; advertiserId: string | null; ownerId: string };
}): {
  userId: string;
  advertiserId: string | null;
  auth: 'jwt' | 'apikey';
} {
  if (req.apiKey) {
    // For machine-to-machine the API key MUST be scoped to a specific
    // advertiser (advertiserId is set at key-creation time and validated
    // server-side). If it's null, the key is generic and cannot act on
    // behalf of a particular advertiser — reject.
    if (!req.apiKey.advertiserId) {
      throw new ForbiddenException(
        'This API key is not scoped to an advertiser — create a per-advertiser key to call /advertiser/* routes',
      );
    }
    return { userId: req.apiKey.ownerId, advertiserId: req.apiKey.advertiserId, auth: 'apikey' };
  }
  const userId = req.user?.sub ?? req.user?.id;
  if (!userId) throw new BadRequestException('Missing authenticated principal');
  return { userId, advertiserId: null, auth: 'jwt' };
}

@ApiTags('Advertiser')
@Controller('advertiser')
@UseGuards(JwtAuthGuard, RolesGuard)
@AllowApiKey() // allow API-key auth alongside JWT on all routes in this controller
@Roles('advertiser')
export class AdvertiserController {
  constructor(
    private service: AdvertiserService,
    private stripe: StripeProvider,
    private config: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Create advertiser profile' })
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  @RequiredScopes('advertiser:write')
  async createProfile(@Req() req: Request, @Body() dto: CreateProfileDto) {
    const ctx = resolveApiContext(req);
    // Profile creation is an interactive user action. API keys are scoped to
    // an existing advertiser profile and must not create or rebind profiles.
    if (ctx.auth === 'apikey') {
      throw new ForbiddenException('API keys cannot create advertiser profiles');
    }
    return this.service.createProfile(ctx.userId, dto);
  }

  @ApiOperation({ summary: 'Get advertiser profile' })
  @Get('profile')
  @RequiredScopes('advertiser:read')
  async getProfile(@Req() req: Request) {
    const ctx = resolveApiContext(req);
    // For API-key auth, return profile of the API key's scoped advertiser,
    // not any advertiser the owner happens to own (machine-to-machine keys
    // shouldn't be able to enumerate an owner's all profiles).
    if (ctx.auth === 'apikey') {
      return this.service.getProfileById(ctx.advertiserId!);
    }
    return this.service.getOrCreateProfile(ctx.userId);
  }

  @ApiOperation({ summary: 'Get advertiser dashboard' })
  @Get('dashboard')
  @RequiredScopes('advertiser:read')
  async getDashboard(@Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.getDashboard(advertiserId);
  }

  @ApiOperation({ summary: 'List campaigns' })
  @Get('campaigns')
  @RequiredScopes('advertiser:read')
  async listCampaigns(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.listCampaigns(advertiserId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status:
        (status as
          | 'draft'
          | 'submitted'
          | 'approved'
          | 'active'
          | 'paused'
          | 'rejected'
          | 'archived'
          | undefined) ?? undefined,
    });
  }

  @ApiOperation({ summary: 'Get campaign' })
  @Get('campaigns/:id')
  @RequiredScopes('advertiser:read')
  async getCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.getCampaign(advertiserId, id);
  }

  @ApiOperation({ summary: 'Get billing' })
  @Get('billing')
  @RequiredScopes('advertiser:read')
  async getBilling(@Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.getBilling(advertiserId);
  }

  @ApiOperation({ summary: 'Create campaign' })
  @Post('campaigns')
  @RequiredScopes('campaigns:write')
  async createCampaign(@Req() req: Request, @Body() dto: CreateCampaignDto) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.createCampaign(advertiserId, dto);
  }

  @ApiOperation({ summary: 'Update campaign' })
  @Patch('campaigns/:id')
  @RequiredScopes('campaigns:write')
  async updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Body() dto: UpdateCampaignDto,
  ) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.updateCampaign(id, advertiserId, dto);
  }

  @ApiOperation({ summary: 'Submit campaign' })
  @Post('campaigns/:id/submit')
  @Audit('submit_campaign', 'campaign', 'id')
  @UseInterceptors(AuditInterceptor)
  @RequiredScopes('campaigns:write')
  async submitCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.submitCampaign(id, advertiserId);
  }

  @ApiOperation({ summary: 'Reset campaign to draft' })
  @Post('campaigns/:id/reset')
  @Audit('reset_campaign', 'campaign', 'id')
  @UseInterceptors(AuditInterceptor)
  @RequiredScopes('campaigns:write')
  async resetCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.resetCampaignToDraft(id, advertiserId);
  }

  @ApiOperation({ summary: 'Pause campaign' })
  @Post('campaigns/:id/pause')
  @Audit('pause_campaign', 'campaign', 'id')
  @UseInterceptors(AuditInterceptor)
  @RequiredScopes('campaigns:write')
  async pauseCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.pauseCampaign(id, advertiserId);
  }

  @ApiOperation({ summary: 'Resume campaign' })
  @Post('campaigns/:id/resume')
  @Audit('resume_campaign', 'campaign', 'id')
  @UseInterceptors(AuditInterceptor)
  @RequiredScopes('campaigns:write')
  async resumeCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.resumeCampaign(id, advertiserId);
  }

  @ApiOperation({ summary: 'Archive campaign' })
  @Post('campaigns/:id/archive')
  @Audit('archive_campaign', 'campaign', 'id')
  @UseInterceptors(AuditInterceptor)
  @RequiredScopes('campaigns:write')
  async archiveCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.archiveCampaign(id, advertiserId);
  }

  @ApiOperation({ summary: 'Get reports' })
  @Get('reports')
  @RequiredScopes('reports:read')
  async getReports(
    @Req() req: Request,
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    // Reject unparseable date strings up-front (a malformed `from`/`to`
    // would otherwise be passed to `new Date(...)` and silently widen the
    // query to "no lower bound" — see getReports in advertiser.service).
    const parsedFrom = from ? new Date(from) : undefined;
    if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
      throw new BadRequestException(`Invalid 'from' date: ${from}`);
    }
    const parsedTo = to ? new Date(to) : undefined;
    if (parsedTo && Number.isNaN(parsedTo.getTime())) {
      throw new BadRequestException(`Invalid 'to' date: ${to}`);
    }
    const parsedPage = page ? Number(page) : undefined;
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.service.getReports(advertiserId, {
      campaignId,
      from,
      to,
      page: parsedPage,
      limit: parsedLimit,
    });
  }

  @ApiOperation({ summary: 'Export reports' })
  @Get('reports/export')
  @RequiredScopes('reports:read')
  async exportReports(
    @Req() req: Request,
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: string,
  ) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    if (format === 'csv') {
      const csv = await this.service.exportReportsCsv(advertiserId, { campaignId, from, to });
      return csv;
    }
    return this.service.getReports(advertiserId, { campaignId, from, to });
  }

  @ApiOperation({ summary: 'Create deposit session' })
  @Post('deposit-session')
  @RequiredScopes('advertiser:write')
  async createDepositSession(@Req() req: Request, @Body() dto: CreateDepositSessionDto) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    const webBaseUrl = this.config.get<string>('WEB_BASE_URL');
    // Fail-closed: if WEB_BASE_URL is unset in production, refuse to generate
    // Stripe checkout links with a broken redirect URL. The default
    // `http://localhost:3000` would silently strand the user's browser
    // on an unreachable host after real money changes hands.
    if (!webBaseUrl) {
      throw new BadRequestException('Platform is not configured. Please contact support.');
    }
    // Re-check the per-currency deposit minimum once the currency is
    // normalized: the DTO's static `@Min` only enforces the global floor, so a
    // policy with a higher `depositMinimumMinor` for a specific currency is
    // enforced here. See A-031.
    const currency = dto.currency ?? 'usd';
    const minimum = depositMinimumMinor(currency);
    const amountMinor = BigInt(dto.amountMinor);
    if (amountMinor < BigInt(minimum)) {
      throw new BadRequestException(`Minimum deposit is ${minimum} minor units`);
    }
    return this.stripe.createDepositSession({
      advertiserId,
      amountMinor,
      currency,
      successUrl: `${webBaseUrl}/advertiser?deposit=success`,
      cancelUrl: `${webBaseUrl}/advertiser?deposit=cancelled`,
    });
  }

  // ── Self-service privacy: export & erasure (A-044) ──
  // These are JWT-only, role-scoped to the advertiser themselves — machine
  // API keys are deliberately NOT allowed to export or erase an account.

  @ApiOperation({ summary: 'Export advertiser data' })
  @Post('export-data')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RejectApiKeyGuard)
  @RequiredScopes('advertiser:write')
  exportData(@CurrentUser('id') userId: string) {
    return this.service.exportData(userId);
  }

  @ApiOperation({ summary: 'Delete advertiser account' })
  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @Audit('delete_account', 'user')
  @UseInterceptors(AuditInterceptor)
  @UseGuards(RejectApiKeyGuard)
  @RequiredScopes('advertiser:write')
  deleteAccount(@CurrentUser('id') userId: string, @Body() dto: DeleteAccountDto) {
    if (dto.confirmation !== 'DELETE_MY_ACCOUNT') {
      throw new BadRequestException('Confirmation string must be exactly DELETE_MY_ACCOUNT');
    }
    // A-044: Mirror the developer deletion step-up model — require either
    // current password or a fresh Google ID token before anonymizing the user.
    return this.service.deleteAccount(userId, {
      currentPassword: dto.currentPassword,
      googleIdToken: dto.googleIdToken,
    });
  }
}

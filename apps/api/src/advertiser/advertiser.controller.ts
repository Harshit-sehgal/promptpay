import { Controller, Get, Post, Patch, Body, Param, UseGuards, Query, HttpCode, HttpStatus, BadRequestException, ForbiddenException, Req, ParseUUIDPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { AdvertiserService } from './advertiser.service';
import { StripeProvider } from '../payout/providers';
import { CreateProfileDto, CreateCampaignDto, UpdateCampaignDto, CreateDepositSessionDto } from './dto';

/**
 * The advertiser routes accept either a JWT (acting user) or an API key
 * (machine-to-machine). When the request is API-key authenticated the
 * resolved credentials are on `request.apiKey`; when JWT-authenticated they
 * are on `request.user`. Helpers below resolve the advertiserId from either
 * source — keeping handler bodies free of auth-shape branching.
 */
function resolveApiContext(req: { user?: { id?: string; sub?: string }; apiKey?: { scopes: string[]; advertiserId: string | null; ownerId: string } }): {
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

  @Post('profile')
  @HttpCode(HttpStatus.OK)
  @RequiredScopes('advertiser:write')
  async createProfile(@Req() req: Request, @Body() dto: CreateProfileDto) {
    const ctx = resolveApiContext(req);
    // Ensures the advertiser profile exists before creating/updating
    ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.createProfile(ctx.userId, dto);
  }

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

  @Get('dashboard')
  @RequiredScopes('advertiser:read')
  async getDashboard(@Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.getDashboard(advertiserId);
  }

  @Post('campaigns')
  @RequiredScopes('campaigns:write')
  async createCampaign(@Req() req: Request, @Body() dto: CreateCampaignDto) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.createCampaign(advertiserId, dto);
  }

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

  @Post('campaigns/:id/submit')
  @RequiredScopes('campaigns:write')
  async submitCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.submitCampaign(id, advertiserId);
  }

  @Post('campaigns/:id/pause')
  @RequiredScopes('campaigns:write')
  async pauseCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.pauseCampaign(id, advertiserId);
  }

  @Post('campaigns/:id/resume')
  @RequiredScopes('campaigns:write')
  async resumeCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.resumeCampaign(id, advertiserId);
  }

  @Post('campaigns/:id/archive')
  @RequiredScopes('campaigns:write')
  async archiveCampaign(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    return this.service.archiveCampaign(id, advertiserId);
  }

  @Get('reports')
  @RequiredScopes('reports:read')
  async getReports(
    @Req() req: Request,
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
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
    return this.service.getReports(advertiserId, { campaignId, from, to });
  }

  @Post('deposit-session')
  @RequiredScopes('advertiser:write')
  async createDepositSession(
    @Req() req: Request,
    @Body() dto: CreateDepositSessionDto,
  ) {
    const ctx = resolveApiContext(req);
    const advertiserId = ctx.advertiserId ?? (await this.service.getOrCreateProfile(ctx.userId)).id;
    const webBaseUrl = this.config.get<string>('WEB_BASE_URL');
    // Fail-closed: if WEB_BASE_URL is unset in production, refuse to generate
    // Stripe checkout links with a broken redirect URL. The default
    // `http://localhost:3000` would silently strand the user's browser
    // on an unreachable host after real money changes hands.
    if (!webBaseUrl) {
      throw new BadRequestException(
        'Platform is not configured. Please contact support.',
      );
    }
    return this.stripe.createDepositSession({
      advertiserId,
      amountMinor: dto.amountMinor,
      currency: dto.currency ?? 'usd',
      successUrl: `${webBaseUrl}/advertiser?deposit=success`,
      cancelUrl: `${webBaseUrl}/advertiser?deposit=cancelled`,
    });
  }
}

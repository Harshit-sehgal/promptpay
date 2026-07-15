import { Request } from 'express';
import {
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
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CreateCountryTargetingDto } from '../advertiser/dto';
import { CurrentUser } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Audit, AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { PrismaService } from '../config/prisma.service';
import { CampaignService, type ServiceActor } from './campaign.service';
import { CreateCreativeDto, UpdateCreativeDto } from './dto';

interface CampaignRequest extends Request {
  apiKey?: {
    ownerId: string;
    advertiserId: string | null;
    scopes: string[];
  };
}

function isAdminRole(role?: string): boolean {
  return role === 'admin' || role === 'super_admin';
}

function resolveCampaignActor(req: CampaignRequest, userId: string, role: string): ServiceActor {
  if (req.apiKey) {
    if (!req.apiKey.advertiserId) {
      throw new ForbiddenException(
        'This API key is not scoped to an advertiser — create a per-advertiser key to call /campaigns/* routes',
      );
    }
    return { userId: req.apiKey.ownerId, role, advertiserId: req.apiKey.advertiserId };
  }
  return { userId, role };
}

@ApiTags('Campaign')
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignController {
  constructor(
    private campaignService: CampaignService,
    private prisma: PrismaService,
  ) {}

  @ApiOperation({ summary: 'Get campaign stats' })
  @Get(':id/stats')
  @AllowApiKey()
  @RequiredScopes('reports:read')
  async getCampaignStats(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Req() req: CampaignRequest,
  ) {
    const actor = resolveCampaignActor(req, userId, role);
    if (!actor.advertiserId && !isAdminRole(role)) {
      await this.verifyOwnership(campaignId, userId);
    }
    // Pass actor to the service so the service-layer ownership check is
    // active even for non-controller callers (jobs, internal helpers).
    return this.campaignService.getCampaignStats(campaignId, actor);
  }

  @ApiOperation({ summary: 'Get creatives' })
  @Get(':id/creatives')
  @AllowApiKey()
  @RequiredScopes('campaigns:read')
  async getCreatives(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Req() req: CampaignRequest,
  ) {
    const actor = resolveCampaignActor(req, userId, role);
    if (!actor.advertiserId && !isAdminRole(role)) {
      await this.verifyOwnership(campaignId, userId);
    }
    return this.campaignService.getCreatives(campaignId, actor);
  }

  @ApiOperation({ summary: 'Create creative' })
  @Post(':id/creatives')
  @HttpCode(HttpStatus.OK)
  @AllowApiKey()
  @RequiredScopes('campaigns:write')
  async createCreative(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: CreateCreativeDto,
    @Req() req: CampaignRequest,
  ) {
    // Admins/super_admins may manage creatives on any campaign (support
    // workflows). Non-admin callers must own the campaign via their
    // advertiser profile. Without this branch an admin is Forbidden'd from
    // creating a creative — the controller layer had no admin bypass path.
    const actor = resolveCampaignActor(req, userId, role);
    if (!actor.advertiserId && !isAdminRole(role)) {
      await this.verifyOwnership(campaignId, userId);
    }
    return this.campaignService.createCreative(campaignId, dto, actor);
  }

  @ApiOperation({ summary: 'Update creative' })
  @Patch('creatives/:creativeId')
  @AllowApiKey()
  @RequiredScopes('campaigns:write')
  async updateCreative(
    @Param('creativeId', ParseUUIDPipe) creativeId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: UpdateCreativeDto,
    @Req() req: CampaignRequest,
  ) {
    const actor = resolveCampaignActor(req, userId, role);
    if (!actor.advertiserId && !isAdminRole(role)) {
      const creative = await this.prisma.adCreative.findUnique({
        where: { id: creativeId },
        select: { campaignId: true },
      });
      if (creative) {
        await this.verifyOwnership(creative.campaignId, userId);
      }
    }
    return this.campaignService.updateCreative(creativeId, dto, actor);
  }

  @ApiOperation({ summary: 'Approve creative' })
  @Post('creatives/:creativeId/approve')
  @HttpCode(HttpStatus.OK)
  @Audit('approve_creative', 'creative', 'creativeId')
  @UseInterceptors(AuditInterceptor)
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  approveCreative(@Param('creativeId', ParseUUIDPipe) creativeId: string) {
    return this.campaignService.approveCreative(creativeId);
  }

  @ApiOperation({ summary: 'Reject creative' })
  @Post('creatives/:creativeId/reject')
  @HttpCode(HttpStatus.OK)
  @Audit('reject_creative', 'creative', 'creativeId')
  @UseInterceptors(AuditInterceptor)
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  rejectCreative(
    @Param('creativeId', ParseUUIDPipe) creativeId: string,
    @Body('reason') reason: string,
  ) {
    return this.campaignService.rejectCreative(creativeId, reason);
  }

  @ApiOperation({ summary: 'Set country targeting' })
  @Post(':id/targeting/countries')
  @HttpCode(HttpStatus.OK)
  @AllowApiKey()
  @RequiredScopes('campaigns:write')
  async setCountryTargeting(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() body: CreateCountryTargetingDto[] | CreateCountryTargetingDto,
    @Req() req: CampaignRequest,
  ) {
    // The endpoint accepts either an array of targeting entries or a single
    // entry object. Normalize to an array so callers cannot crash the server
    // by sending `{ countryCode, include }` instead of `[{ ... }]`.
    const targets = Array.isArray(body) ? body : [body];

    // Admins manage targeting on any campaign; non-admins must own it.
    const actor = resolveCampaignActor(req, userId, role);
    if (!actor.advertiserId && !isAdminRole(role)) {
      await this.verifyOwnership(campaignId, userId);
    }
    return this.campaignService.setCountryTargeting(
      campaignId,
      targets.map((t) => ({ countryCode: t.countryCode, include: t.include })),
      actor,
    );
  }

  /** Verify the authenticated user owns the campaign (via their advertiser profile) */
  private async verifyOwnership(campaignId: string, userId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { advertiserId: true },
    });
    if (!campaign) return; // Let the service handle 404

    const advertiser = await this.prisma.advertiser.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!advertiser || advertiser.id !== campaign.advertiserId) {
      throw new ForbiddenException('You do not own this campaign');
    }
  }
}

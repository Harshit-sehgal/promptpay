import { Controller, Get, Post, Patch, Param, Body, UseGuards, HttpCode, HttpStatus, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators';
import { CampaignService } from './campaign.service';
import { CreateCreativeDto, UpdateCreativeDto } from './dto';
import { CreateCountryTargetingDto } from '../advertiser/dto';
import { PrismaService } from '../config/prisma.service';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignController {
  constructor(
    private campaignService: CampaignService,
    private prisma: PrismaService,
  ) {}

  @Get(':id/stats')
  async getCampaignStats(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (role !== 'admin' && role !== 'super_admin') {
      await this.verifyOwnership(campaignId, userId);
    }
    // Pass actor to the service so the service-layer ownership check is
    // active even for non-controller callers (jobs, internal helpers).
    return this.campaignService.getCampaignStats(campaignId, { userId, role });
  }

  @Get(':id/creatives')
  async getCreatives(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    if (role !== 'admin' && role !== 'super_admin') {
      await this.verifyOwnership(campaignId, userId);
    }
    return this.campaignService.getCreatives(campaignId, { userId, role });
  }

  @Post(':id/creatives')
  @HttpCode(HttpStatus.OK)
  async createCreative(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: CreateCreativeDto,
  ) {
    // Admins/super_admins may manage creatives on any campaign (support
    // workflows). Non-admin callers must own the campaign via their
    // advertiser profile. Without this branch an admin is Forbidden'd from
    // creating a creative — the controller layer had no admin bypass path.
    if (role !== 'admin' && role !== 'super_admin') {
      await this.verifyOwnership(campaignId, userId);
    }
    return this.campaignService.createCreative(campaignId, dto);
  }

  @Patch('creatives/:creativeId')
  async updateCreative(
    @Param('creativeId', ParseUUIDPipe) creativeId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() dto: UpdateCreativeDto,
  ) {
    if (role !== 'admin' && role !== 'super_admin') {
      const creative = await this.prisma.adCreative.findUnique({
        where: { id: creativeId },
        select: { campaignId: true },
      });
      if (creative) {
        await this.verifyOwnership(creative.campaignId, userId);
      }
    }
    return this.campaignService.updateCreative(creativeId, dto);
  }

  @Post('creatives/:creativeId/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  approveCreative(@Param('creativeId', ParseUUIDPipe) creativeId: string) {
    return this.campaignService.approveCreative(creativeId);
  }

  @Post('creatives/:creativeId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  rejectCreative(
    @Param('creativeId', ParseUUIDPipe) creativeId: string,
    @Body('reason') reason: string,
  ) {
    return this.campaignService.rejectCreative(creativeId, reason);
  }

  @Post(':id/targeting/countries')
  @HttpCode(HttpStatus.OK)
  async setCountryTargeting(
    @Param('id', ParseUUIDPipe) campaignId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Body() targets: CreateCountryTargetingDto[],
  ) {
    // Admins manage targeting on any campaign; non-admins must own it.
    if (role !== 'admin' && role !== 'super_admin') {
      await this.verifyOwnership(campaignId, userId);
    }
    return this.campaignService.setCountryTargeting(
      campaignId,
      targets.map(t => ({ countryCode: t.countryCode, include: t.include })),
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

import { Controller, Get, Post, Patch, Param, Body, UseGuards, HttpCode, HttpStatus, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
  getCampaignStats(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.campaignService.getCampaignStats(campaignId);
  }

  @Get(':id/creatives')
  getCreatives(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.campaignService.getCreatives(campaignId);
  }

  @Post(':id/creatives')
  @HttpCode(HttpStatus.OK)
  async createCreative(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCreativeDto,
  ) {
    await this.verifyOwnership(campaignId, userId);
    return this.campaignService.createCreative(campaignId, dto);
  }

  @Patch('creatives/:creativeId')
  updateCreative(
    @Param('creativeId') creativeId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCreativeDto,
  ) {
    return this.campaignService.updateCreative(creativeId, dto);
  }

  @Post(':id/targeting/countries')
  @HttpCode(HttpStatus.OK)
  async setCountryTargeting(
    @Param('id') campaignId: string,
    @CurrentUser('id') userId: string,
    @Body() targets: CreateCountryTargetingDto[],
  ) {
    await this.verifyOwnership(campaignId, userId);
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

import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CampaignService } from './campaign.service';
import { CreateCreativeDto, UpdateCreativeDto } from './dto';
import { CreateCountryTargetingDto } from '../advertiser/dto';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignController {
  constructor(private campaignService: CampaignService) {}

  @Get(':id/stats')
  getCampaignStats(@Param('id') campaignId: string) {
    return this.campaignService.getCampaignStats(campaignId);
  }

  @Get(':id/creatives')
  getCreatives(@Param('id') campaignId: string) {
    return this.campaignService.getCreatives(campaignId);
  }

  @Post(':id/creatives')
  createCreative(@Param('id') campaignId: string, @Body() dto: CreateCreativeDto) {
    return this.campaignService.createCreative(campaignId, dto);
  }

  @Patch('creatives/:creativeId')
  updateCreative(@Param('creativeId') creativeId: string, @Body() dto: UpdateCreativeDto) {
    return this.campaignService.updateCreative(creativeId, dto);
  }

  @Post(':id/targeting/countries')
  setCountryTargeting(
    @Param('id') campaignId: string,
    @Body() targets: CreateCountryTargetingDto[],
  ) {
    return this.campaignService.setCountryTargeting(
      campaignId,
      targets.map(t => ({ countryCode: t.countryCode, include: t.include })),
    );
  }
}

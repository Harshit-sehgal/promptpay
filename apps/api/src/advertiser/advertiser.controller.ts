import { Controller, Get, Post, Patch, Body, Param, UseGuards, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { AdvertiserService } from './advertiser.service';
import { StripeProvider } from '../payout/providers';
import { CreateProfileDto, CreateCampaignDto, UpdateCampaignDto } from './dto';

@Controller('advertiser')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('advertiser')
export class AdvertiserController {
  constructor(
    private service: AdvertiserService,
    private stripe: StripeProvider,
    private config: ConfigService,
  ) {}

  @Post('profile')
  @HttpCode(HttpStatus.OK)
  createProfile(@CurrentUser('id') userId: string, @Body() dto: CreateProfileDto) {
    return this.service.createProfile(userId, dto);
  }

  @Get('profile')
  getProfile(@CurrentUser('id') userId: string) {
    return this.service.getOrCreateProfile(userId);
  }

  @Get('dashboard')
  async getDashboard(@CurrentUser('id') userId: string) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.getDashboard(advertiser.id);
  }

  @Post('campaigns')
  async createCampaign(@CurrentUser('id') userId: string, @Body() dto: CreateCampaignDto) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.createCampaign(advertiser.id, dto);
  }

  @Patch('campaigns/:id')
  async updateCampaign(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.updateCampaign(id, advertiser.id, dto);
  }

  @Post('campaigns/:id/submit')
  async submitCampaign(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.submitCampaign(id, advertiser.id);
  }

  @Post('campaigns/:id/pause')
  async pauseCampaign(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.pauseCampaign(id, advertiser.id);
  }

  @Post('campaigns/:id/resume')
  async resumeCampaign(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.resumeCampaign(id, advertiser.id);
  }

  @Get('reports')
  async getReports(
    @CurrentUser('id') userId: string,
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    return this.service.getReports(advertiser.id, { campaignId, from, to });
  }

  @Post('deposit-session')
  async createDepositSession(
    @CurrentUser('id') userId: string,
    @Body() body: { amountMinor: number; currency?: string },
  ) {
    const advertiser = await this.service.getOrCreateProfile(userId);
    const webBaseUrl = this.config.get<string>('WEB_BASE_URL', 'http://localhost:3000');
    return this.stripe.createDepositSession({
      advertiserId: advertiser.id,
      amountMinor: body.amountMinor,
      currency: body.currency ?? 'usd',
      successUrl: `${webBaseUrl}/advertiser?deposit=success`,
      cancelUrl: `${webBaseUrl}/advertiser?deposit=cancelled`,
    });
  }
}

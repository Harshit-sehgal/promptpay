import { Controller, Get, Post, Patch, Body, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { DeveloperService } from './developer.service';
import { UpdateSettingsDto, EarningsQueryDto } from './dto';

@Controller('developer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class DeveloperController {
  constructor(private service: DeveloperService) {}

  @Get('dashboard') getDashboard(@CurrentUser('id') userId: string) {
    return this.service.getDashboard(userId);
  }

  @Get('earnings')
  getEarnings(
    @CurrentUser('id') userId: string,
    @Query() query: EarningsQueryDto,
  ) {
    return this.service.getEarnings(userId, query);
  }

  @Get('settings') getSettings(@CurrentUser('id') userId: string) {
    return this.service.getSettings(userId);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.service.updateSettings(userId, dto);
  }

  @Post('export-data') exportData(@CurrentUser('id') userId: string) {
    return this.service.exportData(userId);
  }

  @Post('delete-account') deleteAccount(@CurrentUser('id') userId: string) {
    return this.service.deleteAccount(userId);
  }
}

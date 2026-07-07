import { Controller, Get, Post, Patch, Body, UseGuards, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators';
import { RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { DeveloperService } from './developer.service';
import { UpdateSettingsDto, EarningsQueryDto, DeleteAccountDto } from './dto';

@Controller('developer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class DeveloperController {
  constructor(private service: DeveloperService) {}

  @Get('dashboard')
  @RequiredScopes('reports:read')
  getDashboard(@CurrentUser('id') userId: string) {
    return this.service.getDashboard(userId);
  }

  @Get('earnings')
  @RequiredScopes('ledger:read')
  getEarnings(
    @CurrentUser('id') userId: string,
    @Query() query: EarningsQueryDto,
  ) {
    return this.service.getEarnings(userId, query);
  }

  @Get('settings')
  @RequiredScopes('developer:read')
  getSettings(@CurrentUser('id') userId: string) {
    return this.service.getSettings(userId);
  }

  @Get('trust')
  @RequiredScopes('reports:read')
  getTrust(@CurrentUser('id') userId: string) {
    return this.service.getTrust(userId);
  }

  @Patch('settings')
  @RequiredScopes('developer:write')
  updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.service.updateSettings(userId, dto);
  }

  @Post('export-data')
  @HttpCode(HttpStatus.OK)
  @RequiredScopes('developer:write')
  exportData(@CurrentUser('id') userId: string) {
    return this.service.exportData(userId);
  }

  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @RequiredScopes('developer:write')
  deleteAccount(@CurrentUser('id') userId: string, @Body() dto: DeleteAccountDto) {
    return this.service.deleteAccount(userId, {
      confirmation: dto.confirmation,
      currentPassword: dto.currentPassword,
      googleIdToken: dto.googleIdToken,
    });
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { AllowApiKey, RequiredScopes } from '../common/decorators/allow-api-key.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RejectApiKeyGuard } from '../common/guards/reject-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DeveloperService } from './developer.service';
import { DeleteAccountDto, EarningsQueryDto, UpdateSettingsDto } from './dto';

@ApiTags('Developer')
@Controller('developer')
@UseGuards(JwtAuthGuard, RolesGuard)
@AllowApiKey()
@Roles('developer')
export class DeveloperController {
  constructor(private service: DeveloperService) {}

  @ApiOperation({ summary: 'Get developer dashboard' })
  @Get('dashboard')
  @RequiredScopes('reports:read')
  getDashboard(@CurrentUser('id') userId: string) {
    return this.service.getDashboard(userId);
  }

  @ApiOperation({ summary: 'Get earnings' })
  @Get('earnings')
  @RequiredScopes('ledger:read')
  getEarnings(@CurrentUser('id') userId: string, @Query() query: EarningsQueryDto) {
    return this.service.getEarnings(userId, query);
  }

  @ApiOperation({ summary: 'Get settings' })
  @Get('settings')
  @RequiredScopes('developer:read')
  getSettings(@CurrentUser('id') userId: string) {
    return this.service.getSettings(userId);
  }

  @ApiOperation({ summary: 'Get trust' })
  @Get('trust')
  @RequiredScopes('reports:read')
  getTrust(@CurrentUser('id') userId: string) {
    return this.service.getTrust(userId);
  }

  @ApiOperation({ summary: 'Update settings' })
  @Patch('settings')
  @UseGuards(RejectApiKeyGuard)
  @RequiredScopes('developer:write')
  updateSettings(@CurrentUser('id') userId: string, @Body() dto: UpdateSettingsDto) {
    return this.service.updateSettings(userId, dto);
  }

  @ApiOperation({ summary: 'Export developer data' })
  @Post('export-data')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RejectApiKeyGuard)
  @RequiredScopes('developer:write')
  exportData(@CurrentUser('id') userId: string) {
    return this.service.exportData(userId);
  }

  @ApiOperation({ summary: 'Delete developer account' })
  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RejectApiKeyGuard)
  @RequiredScopes('developer:write')
  deleteAccount(@CurrentUser('id') userId: string, @Body() dto: DeleteAccountDto) {
    return this.service.deleteAccount(userId, {
      confirmation: dto.confirmation,
      currentPassword: dto.currentPassword,
      googleIdToken: dto.googleIdToken,
    });
  }
}

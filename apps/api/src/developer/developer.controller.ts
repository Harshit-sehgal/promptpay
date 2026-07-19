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
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { ActionStepUp, ActionStepUpGuard } from '../common/guards/action-step-up.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Audit, AuditInterceptor } from '../common/interceptors/audit.interceptor';
import { DeveloperService } from './developer.service';
import { DeleteAccountDto, EarningsQueryDto, UpdateSettingsDto } from './dto';

@ApiTags('Developer')
@Controller('developer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class DeveloperController {
  constructor(private service: DeveloperService) {}

  // Developer endpoints are JWT-only — no machine-to-machine API-key access.
  // Machine clients must not be able to read personal earnings data, trust
  // scores, or financial ledgers that belong to human developer accounts.

  @ApiOperation({ summary: 'Get developer dashboard' })
  @Get('dashboard')
  getDashboard(@CurrentUser('id') userId: string) {
    return this.service.getDashboard(userId);
  }

  @ApiOperation({ summary: 'Get earnings' })
  @Get('earnings')
  getEarnings(@CurrentUser('id') userId: string, @Query() query: EarningsQueryDto) {
    return this.service.getEarnings(userId, query);
  }

  @ApiOperation({ summary: 'Get settings' })
  @Get('settings')
  getSettings(@CurrentUser('id') userId: string) {
    return this.service.getSettings(userId);
  }

  @ApiOperation({ summary: 'Get trust' })
  @Get('trust')
  getTrust(@CurrentUser('id') userId: string) {
    return this.service.getTrust(userId);
  }

  @ApiOperation({ summary: 'Update settings' })
  @Patch('settings')
  // settings changes (ads enable flag, quiet-mode windows, hourly
  // ad cap, blocked categories, timezone) shape how and whether this account
  // earns, and quiet-mode / blocked-categories can be used to silently stall
  // ad delivery. An attacker who took over the account would flip these to
  // suppress traffic or alter the earning profile; the audit row makes the
  // change visible in the timeline with a scrubbed before/after body snapshot.
  // `targetType: 'user'` so the interceptor fetches the account's pre-state
  // (id/role/status); the settings diff itself is in beforeSnap.body.
  @Audit('update_developer_settings', 'user')
  @UseInterceptors(AuditInterceptor)
  updateSettings(@CurrentUser('id') userId: string, @Body() dto: UpdateSettingsDto) {
    return this.service.updateSettings(userId, dto);
  }

  @ApiOperation({ summary: 'Export developer data' })
  @Post('export-data')
  @HttpCode(HttpStatus.OK)
  exportData(@CurrentUser('id') userId: string) {
    return this.service.exportData(userId);
  }

  @ApiOperation({ summary: 'Delete developer account' })
  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  @Audit('delete_account', 'user')
  @UseInterceptors(AuditInterceptor)
  @UseGuards(ActionStepUpGuard)
  @ActionStepUp('account:delete')
  deleteAccount(@CurrentUser('id') userId: string, @Body() dto: DeleteAccountDto) {
    return this.service.deleteAccount(userId, {
      confirmation: dto.confirmation,
      currentPassword: dto.currentPassword,
      googleIdToken: dto.googleIdToken,
      forfeitBalance: dto.forfeitBalance,
    });
  }
}

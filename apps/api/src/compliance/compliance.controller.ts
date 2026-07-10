import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ComplianceService } from './compliance.service';

class RecordConsentDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9_.:-]+$/i, { message: 'purpose contains unsupported characters' })
  purpose!: string;

  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9_.:-]+$/i, { message: 'version contains unsupported characters' })
  version!: string;

  @IsOptional()
  @IsBoolean()
  granted?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@ApiTags('Consent')
@Controller('consent')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ComplianceController {
  constructor(private compliance: ComplianceService) {}

  @ApiOperation({ summary: 'Record consent' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  record(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') actorRole: string,
    @Body() dto: RecordConsentDto,
  ) {
    return this.compliance.recordConsent(
      userId,
      actorRole,
      dto.purpose,
      dto.version,
      dto.granted ?? true,
      dto.metadata,
    );
  }

  /**
   * Latest required consent versions for THIS user's re-prompt flow. NB: the
   * unauthenticated `GET /consent/required-versions` form is served by the
   * public {@link ConsentVersionsController}; this controller only exposes
   * per-user consent reads/staleness checks behind `JwtAuthGuard`.
   */
  @ApiOperation({ summary: 'Get stale consents' })
  @Get('stale')
  @HttpCode(HttpStatus.OK)
  stale(@CurrentUser('id') userId: string) {
    return this.compliance.getStaleConsents(userId);
  }

  @ApiOperation({ summary: 'Get consent' })
  @Get(':purpose')
  @HttpCode(HttpStatus.OK)
  get(@CurrentUser('id') userId: string, @Param('purpose') purpose: string) {
    return this.compliance.getConsent(userId, purpose);
  }

  @ApiOperation({ summary: 'Get consent status' })
  @Get(':purpose/status')
  @HttpCode(HttpStatus.OK)
  status(@CurrentUser('id') userId: string, @Param('purpose') purpose: string) {
    return this.compliance.isConsented(userId, purpose);
  }
}

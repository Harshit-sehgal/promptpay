import { Controller, Post, Get, Body, Param, UseGuards, HttpCode, HttpStatus, ValidationPipe, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
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

  @Get(':purpose')
  @HttpCode(HttpStatus.OK)
  get(@CurrentUser('id') userId: string, @Param('purpose') purpose: string) {
    return this.compliance.getConsent(userId, purpose);
  }

  @Get(':purpose/status')
  @HttpCode(HttpStatus.OK)
  status(@CurrentUser('id') userId: string, @Param('purpose') purpose: string) {
    return this.compliance.isConsented(userId, purpose);
  }
}

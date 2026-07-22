import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  AdClickDto,
  AdRenderedDto,
  AdRequestDto,
  ConsumeWaitAttestationDto,
  CreateWaitAttestationSessionDto,
  FlagFalsePositiveDto,
  QualifiedImpressionDto,
  RegisterDeviceDto,
  ReportAdDto,
  WaitStateEndDto,
  WaitStateStartDto,
} from './dto';
import { ExtensionService } from './extension.service';

@ApiTags('Extension')
@Controller('extension')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('developer')
export class ExtensionController {
  constructor(private service: ExtensionService) {}

  @ApiOperation({ summary: 'Register device' })
  @Post('register-device')
  @HttpCode(HttpStatus.OK)
  registerDevice(@CurrentUser('id') userId: string, @Body() dto: RegisterDeviceDto) {
    return this.service.registerDevice(userId, dto);
  }

  @ApiOperation({ summary: 'Record wait state start' })
  @Post('wait-state/start')
  @HttpCode(HttpStatus.OK)
  recordWaitStateStart(@CurrentUser('id') userId: string, @Body() dto: WaitStateStartDto) {
    return this.service.recordWaitStateStart(userId, dto);
  }

  @ApiOperation({ summary: 'Record wait state end' })
  @Post('wait-state/end')
  @HttpCode(HttpStatus.OK)
  recordWaitStateEnd(@CurrentUser('id') userId: string, @Body() dto: WaitStateEndDto) {
    return this.service.recordWaitStateEnd(userId, dto);
  }

  @ApiOperation({ summary: 'Create a single-use provider wait-attestation session' })
  @Post('wait-attestation/session')
  @HttpCode(HttpStatus.OK)
  createWaitAttestationSession(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWaitAttestationSessionDto,
  ) {
    return this.service.attestation!.createSession(userId, dto);
  }

  @ApiOperation({ summary: 'Verify and consume a provider-signed wait attestation' })
  @Post('wait-attestation/consume')
  @HttpCode(HttpStatus.OK)
  consumeWaitAttestation(
    @CurrentUser('id') userId: string,
    @Body() dto: ConsumeWaitAttestationDto,
  ) {
    return this.service.attestation!.consume(userId, dto);
  }

  @ApiOperation({
    summary:
      'Flag a wait state as a false positive. Accepts an optional normalized reason + bounded note (P1 #16); repeated reports are idempotent.',
  })
  @Post('wait-state/:waitStateId/false-positive')
  @HttpCode(HttpStatus.OK)
  flagFalsePositive(
    @CurrentUser('id') userId: string,
    @Param('waitStateId') waitStateId: string,
    @Body() dto: FlagFalsePositiveDto,
  ) {
    return this.service.flagFalsePositive(userId, waitStateId, dto);
  }

  @ApiOperation({ summary: 'Request ad' })
  @Post('ad-request')
  @HttpCode(HttpStatus.OK)
  requestAd(@CurrentUser('id') userId: string, @Body() dto: AdRequestDto) {
    return this.service.requestAd(userId, dto);
  }

  @ApiOperation({ summary: 'Record ad rendered' })
  @Post('ad-rendered')
  @HttpCode(HttpStatus.OK)
  recordRendered(@CurrentUser('id') userId: string, @Body() dto: AdRenderedDto) {
    return this.service.recordRendered(userId, dto);
  }

  @ApiOperation({ summary: 'Record qualified impression' })
  @Post('impression-qualified')
  @HttpCode(HttpStatus.OK)
  recordQualifiedImpression(
    @CurrentUser('id') userId: string,
    @Body() dto: QualifiedImpressionDto,
  ) {
    return this.service.recordQualifiedImpression(userId, dto);
  }

  @ApiOperation({ summary: 'Record ad click' })
  @Post('click')
  @HttpCode(HttpStatus.OK)
  recordClick(@CurrentUser('id') userId: string, @Body() dto: AdClickDto) {
    return this.service.recordClick(userId, dto);
  }

  @ApiOperation({ summary: 'Report ad' })
  @Post('report-ad')
  @HttpCode(HttpStatus.OK)
  reportAd(@CurrentUser('id') userId: string, @Body() dto: ReportAdDto) {
    return this.service.reportAd(userId, dto);
  }
}

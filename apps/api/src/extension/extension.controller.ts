import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { ExtensionService } from './extension.service';
import {
  RegisterDeviceDto,
  WaitStateStartDto,
  WaitStateEndDto,
  AdRequestDto,
  AdRenderedDto,
  QualifiedImpressionDto,
  AdClickDto,
  ReportAdDto,
} from './dto';

@Controller('extension')
@UseGuards(JwtAuthGuard)
export class ExtensionController {
  constructor(private service: ExtensionService) {}

  @Post('register-device')
  @HttpCode(HttpStatus.OK)
  registerDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.service.registerDevice(userId, dto);
  }

  @Post('wait-state/start')
  @HttpCode(HttpStatus.OK)
  recordWaitStateStart(
    @CurrentUser('id') userId: string,
    @Body() dto: WaitStateStartDto,
  ) {
    return this.service.recordWaitStateStart(userId, dto);
  }

  @Post('wait-state/end')
  @HttpCode(HttpStatus.OK)
  recordWaitStateEnd(@Body() dto: WaitStateEndDto) {
    return this.service.recordWaitStateEnd(dto);
  }

  @Post('ad-request')
  @HttpCode(HttpStatus.OK)
  requestAd(
    @CurrentUser('id') userId: string,
    @Body() dto: AdRequestDto,
  ) {
    return this.service.requestAd(userId, dto);
  }

  @Post('ad-rendered')
  @HttpCode(HttpStatus.OK)
  recordRendered(@Body() dto: AdRenderedDto) {
    return this.service.recordRendered(dto);
  }

  @Post('impression-qualified')
  @HttpCode(HttpStatus.OK)
  recordQualifiedImpression(@Body() dto: QualifiedImpressionDto) {
    return this.service.recordQualifiedImpression(dto);
  }

  @Post('click')
  @HttpCode(HttpStatus.OK)
  recordClick(@Body() dto: AdClickDto) {
    return this.service.recordClick(dto);
  }

  @Post('report-ad')
  @HttpCode(HttpStatus.OK)
  reportAd(
    @CurrentUser('id') userId: string,
    @Body() dto: ReportAdDto,
  ) {
    return this.service.reportAd(userId, dto);
  }
}

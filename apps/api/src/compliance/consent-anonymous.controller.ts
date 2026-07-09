import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ComplianceService } from './compliance.service';

class AnonymousConsentDto {
  @IsString()
  @MaxLength(256)
  visitorId!: string;

  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9_.:-]+$/i, { message: 'purpose contains unsupported characters' })
  purpose!: string;

  @IsOptional()
  @IsBoolean()
  granted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9_.:-]+$/i, { message: 'version contains unsupported characters' })
  policyVersion?: string;
}

/**
 * Public, unauthenticated anonymous-consent endpoint (A-009).
 *
 * Logged-out visitors cannot create a server-side consent record tied to a
 * user, so this route lets the web cookie banner persist a privacy-minimized
 * consent row keyed only by a sha256 hash of a client-generated pseudonymous
 * `visitorId`. It deliberately lives OUTSIDE the `JwtAuthGuard`-protected
 * {@link ComplianceController} and applies the same strict validation pipe so
 * the purpose is whitelisted and no extra metadata slips through.
 */
@ApiTags('Consent')
@Controller('consent')
export class ConsentAnonymousController {
  constructor(private compliance: ComplianceService) {}

  @Post('anonymous')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  recordAnonymous(@Body() dto: AnonymousConsentDto) {
    return this.compliance.recordAnonymousConsent({
      visitorId: dto.visitorId,
      purpose: dto.purpose,
      granted: dto.granted,
      policyVersion: dto.policyVersion,
    });
  }
}

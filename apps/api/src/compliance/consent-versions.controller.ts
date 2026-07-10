import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ComplianceService } from './compliance.service';

/**
 * Public read-only endpoint for the current required consent versions.
 *
 * `GET /consent/required-versions` is intentionally NOT behind `JwtAuthGuard`
 * because unauthenticated surfaces need it too: the signup page must record
 * the server-required terms/privacy version at account-creation time instead
 * of a hardcoded constant (A-047), and the cookie-consent banner on logged-out
 * pages needs the required `marketing_cookies` version. Only version strings
 * are returned — no user data — so making this public carries no privacy risk.
 *
 * The authenticated `ComplianceController` keeps the per-user `/consent/stale`
 * and `/consent/:purpose` reads behind `JwtAuthGuard`.
 */
@ApiTags('Consent')
@Controller('consent')
export class ConsentVersionsController {
  constructor(private compliance: ComplianceService) {}

  @ApiOperation({ summary: 'Get required consent versions' })
  @Get('required-versions')
  @HttpCode(HttpStatus.OK)
  requiredVersions() {
    return this.compliance.getRequiredConsentVersions();
  }
}

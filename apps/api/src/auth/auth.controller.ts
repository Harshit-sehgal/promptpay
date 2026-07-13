import { Request } from 'express';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators';
import { BruteForceGuard } from '../common/guards/brute-force.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  GoogleOAuthDto,
  LinkGoogleDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  SetSocialPasswordDto,
  SignUpDto,
  TwoFactorBackupCodesRegenerateDto,
  TwoFactorDisableDto,
  TwoFactorEnableDto,
  TwoFactorSetupDto,
  VerifyEmailConfirmDto,
} from './dto';

function isCredentialFailure(err: unknown): boolean {
  return err instanceof UnauthorizedException || err instanceof BadRequestException;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Sign up' })
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signUp(@Body() dto: SignUpDto, @Req() req: Request) {
    try {
      await BruteForceGuard.assertCanAttempt(req, dto.email);
      const result = await this.authService.signUp(dto);
      await BruteForceGuard.resetOnSuccess(req, dto.email);
      return result;
    } catch (err: unknown) {
      // Only count against the brute-force guard for actual auth failures;
      // Conflict (email taken) or BadRequest (validation) are not
      // credential-stuffing events.
      if (err instanceof UnauthorizedException) {
        await BruteForceGuard.recordFailure(req, dto.email);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Log in' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    try {
      await BruteForceGuard.assertCanAttempt(req, dto.email);
      const result = await this.authService.login(dto);
      await BruteForceGuard.resetOnSuccess(req, dto.email);
      return result;
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        await BruteForceGuard.recordFailure(req, dto.email);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Google OAuth login' })
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleOAuth(@Body() dto: GoogleOAuthDto, @Req() req: Request) {
    try {
      await BruteForceGuard.assertCanAttempt(req);
      const result = await this.authService.googleOAuth(dto);
      await BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: unknown) {
      // Google OAuth failures may include ConflictException (account-link reject),
      // UnauthorizedException (invalid token), or BadRequestException (validation).
      // Only the auth-failure branch increments the counter.
      if (err instanceof UnauthorizedException) {
        await BruteForceGuard.recordFailure(req);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Refresh token' })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    // Track repeated refresh-token failures the same way as password attempts.
    // Although the token hash itself is the credential (and JWT signature
    // verification is the canonical check), a refresh-token brute-force would
    // still consume DB lookup budget and surface as authentication noise.
    try {
      await BruteForceGuard.assertCanAttempt(req);
      const result = await this.authService.refresh(dto.refreshToken);
      await BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        await BruteForceGuard.recordFailure(req);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Log out' })
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser('id') userId: string, @CurrentUser('jti') jti: string) {
    return this.authService.logout(userId, jti);
  }

  @ApiOperation({ summary: 'Log out using the refresh session' })
  @Post('logout/refresh')
  @HttpCode(HttpStatus.OK)
  logoutByRefresh(@Body() dto: RefreshDto) {
    return this.authService.logoutByRefreshToken(dto.refreshToken);
  }

  @ApiOperation({ summary: 'List current account sessions' })
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser('id') userId: string, @CurrentUser('jti') jti: string) {
    return this.authService.listSessions(userId, jti);
  }

  @ApiOperation({ summary: 'Revoke all other sessions' })
  @Post('sessions/revoke-others')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  revokeOtherSessions(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
    @CurrentUser('role') role: string,
  ) {
    return this.authService.revokeOtherSessions(userId, jti, role);
  }

  @ApiOperation({ summary: 'Revoke one owned session' })
  @Post('sessions/:id/revoke')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  revokeSession(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(userId, sessionId, role);
  }

  @ApiOperation({ summary: 'Get current user' })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @ApiOperation({ summary: 'Request email verification' })
  @Post('verify-email/request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  requestEmailVerification(@CurrentUser('id') userId: string) {
    return this.authService.requestEmailVerification(userId);
  }

  @ApiOperation({ summary: 'Confirm email verification' })
  @Post('verify-email/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmEmailVerification(@Body() dto: VerifyEmailConfirmDto, @Req() req: Request) {
    // Track repeated verification-token failures so a distributed guessing
    // attack burns through the lockout the same way a password attack does.
    // The route is in `isAuthRoute` so the guard's pre-check rejects
    // already-locked keys before reaching the service.
    try {
      await BruteForceGuard.assertCanAttempt(req);
      const result = await this.authService.confirmEmailVerification(dto.token);
      await BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: unknown) {
      if (isCredentialFailure(err)) {
        await BruteForceGuard.recordFailure(req);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Set up two-factor auth' })
  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser('id') userId: string, @Body() dto: TwoFactorSetupDto) {
    return this.authService.setupTwoFactor(userId, dto);
  }

  @ApiOperation({ summary: 'Enable two-factor auth' })
  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async enableTwoFactor(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
    @Body() dto: TwoFactorEnableDto,
    @Req() req: Request,
  ) {
    try {
      await BruteForceGuard.assertCanAttempt(req, userId);
      const result = await this.authService.enableTwoFactor(userId, dto.token, jti);
      await BruteForceGuard.resetOnSuccess(req, userId);
      return result;
    } catch (err: unknown) {
      if (isCredentialFailure(err)) {
        await BruteForceGuard.recordFailure(req, userId);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Regenerate one-time two-factor backup codes' })
  @Post('2fa/backup-codes/regenerate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  regenerateTwoFactorBackupCodes(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
    @Body() dto: TwoFactorBackupCodesRegenerateDto,
  ) {
    return this.authService.regenerateTwoFactorBackupCodes(userId, dto.token, jti);
  }

  @ApiOperation({ summary: 'Disable two-factor auth' })
  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disableTwoFactor(
    @CurrentUser('id') userId: string,
    @Body() dto: TwoFactorDisableDto,
    @Req() req: Request,
  ) {
    try {
      await BruteForceGuard.assertCanAttempt(req, userId);
      const result = await this.authService.disableTwoFactor(userId, dto.token);
      await BruteForceGuard.resetOnSuccess(req, userId);
      return result;
    } catch (err: unknown) {
      if (isCredentialFailure(err)) {
        await BruteForceGuard.recordFailure(req, userId);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Request password reset' })
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    // Per-email brute-force protection against password-reset enumeration
    // and token-flooding. Mirrors the login guard: only credential-style
    // failures count, but here we pre-check before issuing a reset email.
    try {
      await BruteForceGuard.assertCanAttempt(req, dto.email);
    } catch {
      // Fail closed: surface a generic throttle response without disclosing
      // whether the email exists. The route still returns 200 with the same
      // generic message as a successful request.
      return { message: 'If that email exists, a reset link has been sent.' };
    }
    const result = await this.authService.requestPasswordReset(dto.email);
    await BruteForceGuard.resetOnSuccess(req, dto.email);
    return result;
  }

  @ApiOperation({ summary: 'Reset password' })
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    try {
      await BruteForceGuard.assertCanAttempt(req);
      const result = await this.authService.resetPassword(dto.token, dto.newPassword);
      await BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: unknown) {
      if (isCredentialFailure(err)) {
        await BruteForceGuard.recordFailure(req);
      }
      throw err;
    }
  }

  @ApiOperation({ summary: 'Set a password on a social-login account' })
  @Post('password/set')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  setSocialPassword(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
    @Body() dto: SetSocialPasswordDto,
  ) {
    return this.authService.setSocialAccountPassword(userId, jti, dto);
  }

  @ApiOperation({ summary: 'Link Google after explicit account reauthentication' })
  @Post('link/google')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  linkGoogle(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
    @Body() dto: LinkGoogleDto,
  ) {
    return this.authService.linkGoogle(userId, jti, dto);
  }

  @ApiOperation({ summary: 'Get auth config' })
  @Get('config')
  @HttpCode(HttpStatus.OK)
  getConfig() {
    return {
      googleClientId: this.authService.getGoogleClientId(),
    };
  }
}

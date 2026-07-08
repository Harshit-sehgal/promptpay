import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import {
  SignUpDto,
  LoginDto,
  RefreshDto,
  GoogleOAuthDto,
  VerifyEmailConfirmDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  TwoFactorEnableDto,
  TwoFactorDisableDto,
} from './dto';
import { BruteForceGuard } from '../common/guards/brute-force.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
  ) {
    return this.authService.logout(userId, jti);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Post('verify-email/request')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  requestEmailVerification(@CurrentUser('id') userId: string) {
    return this.authService.requestEmailVerification(userId);
  }

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
      if (err instanceof UnauthorizedException) {
        await BruteForceGuard.recordFailure(req);
      }
      throw err;
    }
  }

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser('id') userId: string) {
    return this.authService.setupTwoFactor(userId);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  enableTwoFactor(@CurrentUser('id') userId: string, @Body() dto: TwoFactorEnableDto) {
    return this.authService.enableTwoFactor(userId, dto.token);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  disableTwoFactor(@CurrentUser('id') userId: string, @Body() dto: TwoFactorDisableDto) {
    return this.authService.disableTwoFactor(userId, dto.token);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    try {
      await BruteForceGuard.assertCanAttempt(req);
      const result = await this.authService.resetPassword(dto.token, dto.newPassword);
      await BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        await BruteForceGuard.recordFailure(req);
      }
      throw err;
    }
  }

  @Get('config')
  @HttpCode(HttpStatus.OK)
  getConfig() {
    return {
      googleClientId: this.authService.getGoogleClientId(),
    };
  }
}

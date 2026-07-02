import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { SignUpDto, LoginDto, RefreshDto, GoogleOAuthDto, VerifyEmailConfirmDto } from './dto';
import { BruteForceGuard } from '../common/guards/brute-force.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signUp(@Body() dto: SignUpDto, @Req() req: any) {
    try {
      const result = await this.authService.signUp(dto);
      BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: any) {
      BruteForceGuard.recordFailure(req);
      throw err;
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    try {
      const result = await this.authService.login(dto);
      BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: any) {
      BruteForceGuard.recordFailure(req);
      throw err;
    }
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleOAuth(@Body() dto: GoogleOAuthDto, @Req() req: any) {
    try {
      const result = await this.authService.googleOAuth(dto);
      BruteForceGuard.resetOnSuccess(req);
      return result;
    } catch (err: any) {
      BruteForceGuard.recordFailure(req);
      throw err;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
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
  confirmEmailVerification(@Body() dto: VerifyEmailConfirmDto) {
    return this.authService.confirmEmailVerification(dto.token);
  }

  @Get('config')
  @HttpCode(HttpStatus.OK)
  getConfig() {
    return {
      googleClientId: this.authService.getGoogleClientId(),
    };
  }
}
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { FraudModule } from '../fraud/fraud.module';
import { EmailModule } from '../email/email.module';
import { SessionCleanupCron } from './session-cleanup.cron';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const accessTtl = config.get<string>('JWT_ACCESS_TTL', '15m');
        return {
          secret: config.get<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: accessTtl as unknown as number,
          },
        };
      },
    }),
    FraudModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleTokenVerifier, SessionCleanupCron],
  exports: [AuthService, JwtModule, GoogleTokenVerifier],
})
export class AuthModule {}

import type { StringValue } from 'ms';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { EmailModule } from '../email/email.module';
import { FraudModule } from '../fraud/fraud.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { deriveKeyId } from './jwt-key-id';
import { SessionCleanupCron } from './session-cleanup.cron';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const accessTtl = config.get<string>('JWT_ACCESS_TTL', '15m');
        const privateKey = config.get<string>('JWT_PRIVATE_KEY');
        const publicKey = config.get<string>('JWT_PUBLIC_KEY');
        if (!privateKey || !publicKey) {
          throw new Error(
            'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be defined for RS256 token signing.',
          );
        }
        // Derive a stable key ID from the public key so verification can
        // detect key rotation and clients can select the right JWKS key.
        const kid = deriveKeyId(publicKey);
        const issuer = config.get<string>('JWT_ISSUER', 'waitlayer');
        const audience = config.get<string>('JWT_AUDIENCE', 'waitlayer-client');
        return {
          privateKey,
          publicKey,
          signOptions: {
            algorithm: 'RS256',
            keyid: kid,
            // `accessTtl` is a string like '15m'; jsonwebtoken accepts it, but
            // the @nestjs/jwt typing expects the narrower `StringValue` union.
            expiresIn: accessTtl as StringValue,
          },
          verifyOptions: {
            algorithms: ['RS256'],
            issuer,
            audience,
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

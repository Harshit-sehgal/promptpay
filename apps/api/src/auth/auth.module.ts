import type { StringValue } from 'ms';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { EmailModule } from '../email/email.module';
import { FraudModule } from '../fraud/fraud.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { deriveKeyId } from './jwt-key-id';
import { validateJwtSigningKeyPair } from './jwt-keys';
import { SessionCleanupCron } from './session-cleanup.cron';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';
import { JwtStrategy } from './strategies/jwt.strategy';

export function createJwtModuleOptions(config: ConfigService): JwtModuleOptions {
  const accessTtl = config.get<string>('JWT_ACCESS_TTL', '15m');
  const rawPrivateKey = config.get<string>('JWT_PRIVATE_KEY');
  const rawPublicKey = config.get<string>('JWT_PUBLIC_KEY');
  if (!rawPrivateKey || !rawPublicKey) {
    throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be defined for RS256 token signing.');
  }
  // A-097: PEMs are stored single-line with literal `\n` escapes because
  // Compose/--env-file cannot carry multi-line values. Validate the
  // normalised pair before Nest finishes initialising: independently
  // valid but mismatched keys would issue tokens this API cannot verify.
  const { privateKey, publicKey } = validateJwtSigningKeyPair(rawPrivateKey, rawPublicKey);
  // Derive a stable key ID from the public key so verification can
  // detect key rotation and clients can select the right JWKS key.
  const kid = deriveKeyId(publicKey);
  const issuer = config.get<string>('JWT_ISSUER', 'ateva');
  const audience = config.get<string>('JWT_AUDIENCE', 'ateva-client');
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
}

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: createJwtModuleOptions,
    }),
    FraudModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleTokenVerifier, SessionCleanupCron],
  exports: [AuthService, JwtModule, GoogleTokenVerifier],
})
export class AuthModule {}

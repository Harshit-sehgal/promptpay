import { StringValue } from 'ms';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { FraudService } from '../fraud/fraud.service';
import { AuthCoreTrait } from './auth-core.trait';
import { AuthEmailTrait } from './auth-email.trait';
import { AuthPasswordTrait } from './auth-password.trait';
import { AuthSessionTrait } from './auth-session.trait';
import { AuthTotpTrait } from './auth-totp.trait';
import { GoogleTokenVerifier } from './strategies/google-token-verifier';

@Injectable()
export class AuthService {
  // The TOTP trait (auth-totp.trait.ts) calls `this.logger.warn(...)` on the
  // dev-fallback path of `buildTotpEncryptionKey`, which runs in the
  // constructor below. The trait's `declare logger: Logger` is compile-time
  // only — it emits no runtime field — so without this concrete initializer
  // `this.logger` is `undefined` and AuthService construction throws in any
  // non-production environment lacking TOTP_SECRET_ENCRYPTION_KEY (every unit
  // test + local dev boot). Field initializers run before the constructor
  // body, so this is set before buildTotpEncryptionKey() runs. Declared
  // public+readonly (not private) to satisfy the trait's `declare logger:
  // Logger` — TS rejects a private field that an extended trait interface
  // expects to be public (TS2430).
  readonly logger = new Logger(AuthService.name);
  readonly publicKey: string;

  constructor(
    public prisma: PrismaService,
    public jwt: JwtService,
    public config: ConfigService,
    public googleVerifier: GoogleTokenVerifier,
    public fraud: FraudService,
    public email: EmailQueueService,
    public audit: AuditService,
  ) {
    // Brand the config strings as `StringValue` so they satisfy jsonwebtoken's
    // `expiresIn` type. The defaults ('15m', '30d') and any runtime
    // JWT_*_TTL override are valid `ms` duration strings; an invalid value
    // would fail at sign time, not typecheck.
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m') as StringValue;
    this.refreshTtl = this.config.get<string>('JWT_REFRESH_TTL', '30d') as StringValue;
    const privateKey = this.config.get<string>('JWT_PRIVATE_KEY');
    const publicKey = this.config.get<string>('JWT_PUBLIC_KEY');
    const hmacSecret = this.config.get<string>('JWT_SECRET');
    if (!privateKey || !publicKey) {
      throw new Error(
        'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be defined for RS256 token signing.',
      );
    }
    if (!hmacSecret || hmacSecret.length < 32) {
      throw new Error(
        'JWT_SECRET must be defined and at least 32 characters for refresh-token HMAC and BFF identity signing.',
      );
    }
    this.publicKey = publicKey;
    this.jwtSecret = hmacSecret;
    this.totpEncryptionKey = this.buildTotpEncryptionKey();
  }
}

export interface AuthService
  extends AuthCoreTrait, AuthEmailTrait, AuthTotpTrait, AuthPasswordTrait, AuthSessionTrait {}

for (const name of Object.getOwnPropertyNames(AuthCoreTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AuthService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AuthCoreTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AuthEmailTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AuthService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AuthEmailTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AuthTotpTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AuthService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AuthTotpTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AuthPasswordTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AuthService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AuthPasswordTrait.prototype, name) as PropertyDescriptor,
  );
}
for (const name of Object.getOwnPropertyNames(AuthSessionTrait.prototype)) {
  if (name === 'constructor') continue;
  Object.defineProperty(
    AuthService.prototype,
    name,
    Object.getOwnPropertyDescriptor(AuthSessionTrait.prototype, name) as PropertyDescriptor,
  );
}

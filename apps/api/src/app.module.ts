import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottleByRouteGuard } from './common/guards/throttle-by-route.guard';
import { BruteForceGuard } from './common/guards/brute-force.guard';
import { RedisBackedThrottlerStorage } from './common/rate-limit/redis-throttler.storage';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { AuthModule } from './auth/auth.module';
import { DeveloperModule } from './developer/developer.module';
import { AdvertiserModule } from './advertiser/advertiser.module';
import { AdminModule } from './admin/admin.module';
import { ExtensionModule } from './extension/extension.module';
import { LedgerModule } from './ledger/ledger.module';
import { PayoutModule } from './payout/payout.module';
import { FraudModule } from './fraud/fraud.module';
import { CampaignModule } from './campaign/campaign.module';
import { AuditModule } from './audit/audit.module';
import { ReferralModule } from './referral/referral.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from './config/prisma.module';
import { HealthModule } from './health/health.module';
import { ComplianceModule } from './compliance/compliance.module';

@Module({
  imports: [
    // SentryModule is a no-op when Sentry is not configured (no DSN)
    SentryModule.forRoot(),

    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        storage: await RedisBackedThrottlerStorage.create(config),
        throttlers: [
          { ttl: 60_000, limit: 10, name: 'auth-short' },   // auth endpoints: 10 req/min
          { ttl: 300_000, limit: 30, name: 'auth-long' },    // auth endpoints: 30 req/5min
          { ttl: 60_000, limit: 60, name: 'extension' },     // extension: 60 req/min (catches rate-limit fraud)
          { ttl: 60_000, limit: 200, name: 'default' },      // everything else: 200 req/min
        ],
      }),
    }),
    PrismaModule,
    HealthModule,
    AuditModule,
    AuthModule,
    DeveloperModule,
    AdvertiserModule,
    AdminModule,
    ExtensionModule,
    LedgerModule,
    PayoutModule,
    FraudModule,
    CampaignModule,
    ReferralModule,
    ComplianceModule,
  ],
  providers: [
    // ApiKeyGuard first: it's a no-op unless `x-api-key` is present AND the
    // route opted in via @AllowApiKey(). Otherwise it passes through and lets
    // JwtAuthGuard authenticate the request normally.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: BruteForceGuard },
    { provide: APP_GUARD, useClass: ThrottleByRouteGuard },
  ],
})
export class AppModule {}

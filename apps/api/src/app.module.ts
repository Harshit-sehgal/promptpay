import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';

import { AdminModule } from './admin/admin.module';
import { AdvertiserModule } from './advertiser/advertiser.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CampaignModule } from './campaign/campaign.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { BruteForceGuard } from './common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from './common/guards/throttle-by-route.guard';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RedisBackedThrottlerStorage } from './common/rate-limit/redis-throttler.storage';
import { ComplianceModule } from './compliance/compliance.module';
import { PrismaModule } from './config/prisma.module';
import { DeveloperModule } from './developer/developer.module';
import { ExtensionModule } from './extension/extension.module';
import { FraudModule } from './fraud/fraud.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { PayoutModule } from './payout/payout.module';
import { ReferralModule } from './referral/referral.module';

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
    // Cache-Control headers on every response (no-store for authed routes,
    // short public cache for the health probe + docs).
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Request-id correlation middleware for all routes, declared here via
    // MiddlewareConsumer so all request middleware lives in one place.
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}


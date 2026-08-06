import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';

import { loadEnv } from '@waitlayer/config';

import { AdminModule } from './admin/admin.module';
import { AdvertiserModule } from './advertiser/advertiser.module';
import { AgentModule } from './agent/agent.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CampaignModule } from './campaign/campaign.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { BruteForceGuard } from './common/guards/brute-force.guard';
import { ThrottleByRouteGuard } from './common/guards/throttle-by-route.guard';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import {
  THROTTLER_STORAGE,
  ThrottlerStorageModule,
} from './common/rate-limit/redis-throttler.storage';
import { ComplianceModule } from './compliance/compliance.module';
import { EnvironmentMarkerService } from './config/environment-marker.service';
import { PrismaModule } from './config/prisma.module';
import { DeveloperModule } from './developer/developer.module';
import { ExtensionModule } from './extension/extension.module';
import { FeedbackModule } from './feedback/feedback.module';
import { FraudModule } from './fraud/fraud.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { ObservabilityModule } from './observability/observability.module';
import { PayoutModule } from './payout/payout.module';
import { ReferralModule } from './referral/referral.module';
import { SandboxModule } from './sandbox/sandbox.module';

@Module({
  imports: [
    // SentryModule is a no-op when Sentry is not configured (no DSN)
    SentryModule.forRoot(),

    // Wire the validated, defaulted environment from `@waitlayer/config` into
    // Nest's ConfigService so every service reads the same values that were
    // validated at boot (A-017). `loadEnv` returns the schema defaults (e.g.
    // WEB_BASE_URL defaults to http://localhost:3000 in non-production), so
    // `configService.get('WEB_BASE_URL')` returns a value even when the var is
    // unset — instead of `undefined` as before. Explicit env vars still
    // override the defaults (process.env has higher precedence than `load`).
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadEnv(process.env)] }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, ThrottlerStorageModule],
      // THROTTLER_STORAGE is provided by the global ThrottlerStorageModule
      // (below) so the storage instance participates in the module lifecycle:
      // `onModuleDestroy` disconnects its Redis client on shutdown
      // (event-loop hang guard).
      inject: [THROTTLER_STORAGE, ConfigService],
      useFactory: async (storage: ThrottlerStorage, config: ConfigService) => ({
        storage,
        throttlers: [
          // Defaults are the production security posture; the THROTTLE_*_LIMIT
          // env overrides exist for isolated test/CI APIs that must complete
          // many auth calls quickly. Never raise them on a public production API.
          {
            ttl: 60_000,
            limit: config.get<number>('THROTTLE_AUTH_SHORT_LIMIT') ?? 10,
            name: 'auth-short',
          }, // auth endpoints: 10 req/min
          {
            ttl: 300_000,
            limit: config.get<number>('THROTTLE_AUTH_LONG_LIMIT') ?? 30,
            name: 'auth-long',
          }, // auth endpoints: 30 req/5min
          {
            ttl: 60_000,
            limit: config.get<number>('THROTTLE_EXTENSION_LIMIT') ?? 60,
            name: 'extension',
          }, // extension: 60 req/min (catches rate-limit fraud)
          {
            ttl: 60_000,
            limit: config.get<number>('THROTTLE_DEFAULT_LIMIT') ?? 200,
            name: 'default',
          }, // everything else: 200 req/min
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
    AgentModule,
    ExtensionModule,
    FeedbackModule,
    LedgerModule,
    PayoutModule,
    FraudModule,
    CampaignModule,
    ReferralModule,
    SandboxModule,
    ComplianceModule,
    ObservabilityModule,
  ],
  providers: [
    // ApiKeyGuard first: it's a no-op unless `x-api-key` is present AND the
    // route opted in via @AllowApiKey(). Otherwise it passes through and lets
    // JwtAuthGuard authenticate the request normally.
    EnvironmentMarkerService,
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
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

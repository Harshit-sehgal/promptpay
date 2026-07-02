import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottleByRouteGuard } from './common/guards/throttle-by-route.guard';
import { BruteForceGuard } from './common/guards/brute-force.guard';
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
import { PrismaModule } from './config/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: 10, name: 'auth-short' },   // auth endpoints: 10 req/min
      { ttl: 300_000, limit: 30, name: 'auth-long' },    // auth endpoints: 30 req/5min
      { ttl: 60_000, limit: 60, name: 'extension' },     // extension: 60 req/min (catches rate-limit fraud)
      { ttl: 60_000, limit: 200, name: 'default' },      // everything else: 200 req/min
    ]),
    PrismaModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: BruteForceGuard },
    { provide: APP_GUARD, useClass: ThrottleByRouteGuard },
  ],
})
export class AppModule {}

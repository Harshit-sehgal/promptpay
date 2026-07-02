-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('developer', 'advertiser', 'admin', 'support', 'super_admin');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'restricted', 'banned', 'deleted');

-- CreateEnum
CREATE TYPE "TrustLevel" AS ENUM ('new', 'low_trust', 'normal', 'high_trust', 'restricted', 'banned');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'submitted', 'approved', 'active', 'paused', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'paused');

-- CreateEnum
CREATE TYPE "BidType" AS ENUM ('cpm', 'cpc');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('wait_state_start', 'wait_state_end', 'ad_request', 'ad_rendered', 'qualified_impression', 'click', 'report_ad');

-- CreateEnum
CREATE TYPE "ToolTypeEnum" AS ENUM ('vscode', 'cursor', 'cline', 'windsurf', 'aider', 'codex_cli', 'claude_code', 'terminal', 'browser');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('debit', 'credit', 'hold', 'release', 'reversal', 'payout', 'refund', 'reserve', 'fee');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('estimated', 'pending', 'confirmed', 'held', 'reversed', 'paid', 'void');

-- CreateEnum
CREATE TYPE "PayoutProvider" AS ENUM ('manual', 'paypal_email', 'paypal_payouts', 'stripe_connect', 'payoneer', 'wise', 'razorpay');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('draft', 'requested', 'under_review', 'approved', 'rejected', 'processing', 'paid', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "FraudFlagStatus" AS ENUM ('open', 'reviewing', 'resolved_valid', 'resolved_invalid', 'escalated');

-- CreateEnum
CREATE TYPE "FraudFlagType" AS ENUM ('impression_rate_limit', 'click_rate_limit', 'duplicate_device', 'suspicious_ctr', 'impossible_volume', 'shared_payout_destination', 'vpn_proxy_pattern', 'emulator_vm_pattern', 'rapid_earning_spike', 'country_device_change', 'repeated_click_abuse', 'self_clicking', 'automated_pattern', 'duplicate_account');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected', 'changes_requested');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'developer',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "trustLevel" "TrustLevel" NOT NULL DEFAULT 'new',
    "country" TEXT,
    "googleId" TEXT,
    "githubId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "googleVerified" BOOLEAN NOT NULL DEFAULT false,
    "githubVerified" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminRole" "UserRole" NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT,
    "ipHash" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenFamily" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "publicKey" TEXT,
    "toolType" "ToolTypeEnum" NOT NULL,
    "extensionVersion" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietMode" BOOLEAN NOT NULL DEFAULT false,
    "quietModeStart" TEXT NOT NULL DEFAULT '22:00',
    "quietModeEnd" TEXT NOT NULL DEFAULT '08:00',
    "maxAdsPerHour" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PayoutProvider" NOT NULL,
    "destination" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "websiteUrl" TEXT,
    "trustStatus" "TrustLevel" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "category" TEXT NOT NULL,
    "bidType" "BidType" NOT NULL,
    "bidAmountMinor" INTEGER NOT NULL,
    "budgetTotalMinor" INTEGER NOT NULL,
    "budgetSpentMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "frequencyCapPerHour" INTEGER NOT NULL DEFAULT 2,
    "frequencyCapPerDay" INTEGER NOT NULL DEFAULT 6,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creatives" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sponsoredMessage" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "displayDomain" TEXT NOT NULL,
    "status" "CreativeStatus" NOT NULL DEFAULT 'draft',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_creatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "isMvpAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_categories" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "blockedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country_targeting" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "include" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "country_targeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_integrations" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ToolTypeEnum" NOT NULL,
    "minVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wait_state_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "waitStateId" TEXT NOT NULL,
    "toolType" "ToolTypeEnum" NOT NULL,
    "duration" INTEGER,
    "ipHash" TEXT,
    "signature" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wait_state_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_impressions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "waitStateId" TEXT,
    "idempotencyKey" TEXT,
    "impressionTokenHash" TEXT NOT NULL,
    "renderedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "visibleDurationMs" INTEGER,
    "visibleSurface" DOUBLE PRECISION,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "invalidationReason" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_clicks" (
    "id" TEXT NOT NULL,
    "impressionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "invalidationReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_reports" (
    "id" TEXT NOT NULL,
    "impressionId" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT,
    "impressionId" TEXT,
    "clickId" TEXT,
    "entryType" "LedgerEntryType" NOT NULL,
    "status" "LedgerStatus" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "availableAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertiser_ledger" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "campaignId" TEXT,
    "stripePaymentIntentId" TEXT,
    "entryType" "LedgerEntryType" NOT NULL,
    "status" "LedgerStatus" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertiser_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_ledger" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "entryType" "LedgerEntryType" NOT NULL,
    "status" "LedgerStatus" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "bucket" TEXT NOT NULL,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payoutAccountId" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'draft',
    "requestedAmountMinor" INTEGER NOT NULL,
    "approvedAmountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "processedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_allocations" (
    "id" TEXT NOT NULL,
    "payoutRequestId" TEXT NOT NULL,
    "earningsEntryId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_transactions" (
    "id" TEXT NOT NULL,
    "payoutRequestId" TEXT NOT NULL,
    "provider" "PayoutProvider" NOT NULL,
    "providerTxId" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'processing',
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "campaignId" TEXT,
    "impressionId" TEXT,
    "clickId" TEXT,
    "flagType" "FraudFlagType" NOT NULL,
    "severity" "FraudSeverity" NOT NULL DEFAULT 'medium',
    "status" "FraudFlagStatus" NOT NULL DEFAULT 'open',
    "scoreDelta" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL,
    "reviewNote" TEXT,
    "reviewerId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_scores" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 40,
    "level" "TrustLevel" NOT NULL DEFAULT 'new',
    "accountAgePoints" INTEGER NOT NULL DEFAULT 0,
    "emailVerifiedPts" INTEGER NOT NULL DEFAULT 0,
    "githubVerifiedPts" INTEGER NOT NULL DEFAULT 0,
    "googleVerifiedPts" INTEGER NOT NULL DEFAULT 0,
    "deviceConsistPts" INTEGER NOT NULL DEFAULT 0,
    "activityPatternPts" INTEGER NOT NULL DEFAULT 0,
    "payoutHistoryPts" INTEGER NOT NULL DEFAULT 0,
    "fraudPenaltyPts" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trust_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_approvals" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "reason" TEXT,
    "checklist" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "advertiserId" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processingStatus" TEXT NOT NULL DEFAULT 'pending',
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeSnap" JSONB,
    "afterSnap" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "LedgerStatus" NOT NULL DEFAULT 'estimated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_userId_key" ON "admin_users"("userId");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_tokenHash_idx" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_tokenFamily_idx" ON "sessions"("tokenFamily");

-- CreateIndex
CREATE INDEX "devices_fingerprintHash_idx" ON "devices"("fingerprintHash");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_fingerprintHash_key" ON "devices"("userId", "fingerprintHash");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_accounts_userId_provider_isActive_key" ON "payout_accounts"("userId", "provider", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "advertisers_userId_key" ON "advertisers"("userId");

-- CreateIndex
CREATE INDEX "campaigns_advertiserId_idx" ON "campaigns"("advertiserId");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_status_category_idx" ON "campaigns"("status", "category");

-- CreateIndex
CREATE INDEX "ad_creatives_campaignId_idx" ON "ad_creatives"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "country_targeting_campaignId_idx" ON "country_targeting"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "country_targeting_campaignId_countryCode_key" ON "country_targeting"("campaignId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "tool_integrations_slug_key" ON "tool_integrations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "wait_state_events_idempotencyKey_key" ON "wait_state_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "wait_state_events_userId_createdAt_idx" ON "wait_state_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "wait_state_events_deviceId_createdAt_idx" ON "wait_state_events"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "wait_state_events_waitStateId_eventType_idx" ON "wait_state_events"("waitStateId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "ad_impressions_idempotencyKey_key" ON "ad_impressions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ad_impressions_impressionTokenHash_key" ON "ad_impressions"("impressionTokenHash");

-- CreateIndex
CREATE INDEX "ad_impressions_campaignId_qualifiedAt_idx" ON "ad_impressions"("campaignId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "ad_impressions_userId_qualifiedAt_idx" ON "ad_impressions"("userId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "ad_impressions_deviceId_qualifiedAt_idx" ON "ad_impressions"("deviceId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "ad_impressions_ipHash_qualifiedAt_idx" ON "ad_impressions"("ipHash", "qualifiedAt");

-- CreateIndex
CREATE INDEX "ad_impressions_isBillable_createdAt_idx" ON "ad_impressions"("isBillable", "createdAt");

-- CreateIndex
CREATE INDEX "ad_impressions_userId_sessionId_idx" ON "ad_impressions"("userId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_clicks_idempotencyKey_key" ON "ad_clicks"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ad_clicks_impressionId_idx" ON "ad_clicks"("impressionId");

-- CreateIndex
CREATE INDEX "ad_clicks_userId_createdAt_idx" ON "ad_clicks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ad_clicks_isValid_createdAt_idx" ON "ad_clicks"("isValid", "createdAt");

-- CreateIndex
CREATE INDEX "ad_clicks_campaignId_idx" ON "ad_clicks"("campaignId");

-- CreateIndex
CREATE INDEX "ad_clicks_creativeId_idx" ON "ad_clicks"("creativeId");

-- CreateIndex
CREATE INDEX "ad_reports_impressionId_idx" ON "ad_reports"("impressionId");

-- CreateIndex
CREATE INDEX "ad_reports_userId_idx" ON "ad_reports"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_ledger_idempotencyKey_key" ON "earnings_ledger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "earnings_ledger_userId_status_availableAt_idx" ON "earnings_ledger"("userId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "earnings_ledger_campaignId_idx" ON "earnings_ledger"("campaignId");

-- CreateIndex
CREATE INDEX "earnings_ledger_createdAt_idx" ON "earnings_ledger"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "advertiser_ledger_idempotencyKey_key" ON "advertiser_ledger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "advertiser_ledger_advertiserId_status_idx" ON "advertiser_ledger"("advertiserId", "status");

-- CreateIndex
CREATE INDEX "advertiser_ledger_campaignId_idx" ON "advertiser_ledger"("campaignId");

-- CreateIndex
CREATE INDEX "advertiser_ledger_createdAt_idx" ON "advertiser_ledger"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_idempotencyKey_key" ON "platform_ledger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "platform_ledger_bucket_status_idx" ON "platform_ledger"("bucket", "status");

-- CreateIndex
CREATE INDEX "platform_ledger_campaignId_idx" ON "platform_ledger"("campaignId");

-- CreateIndex
CREATE INDEX "platform_ledger_createdAt_idx" ON "platform_ledger"("createdAt");

-- CreateIndex
CREATE INDEX "payout_requests_userId_idx" ON "payout_requests"("userId");

-- CreateIndex
CREATE INDEX "payout_requests_status_idx" ON "payout_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_allocations_earningsEntryId_key" ON "payout_allocations"("earningsEntryId");

-- CreateIndex
CREATE INDEX "payout_transactions_payoutRequestId_idx" ON "payout_transactions"("payoutRequestId");

-- CreateIndex
CREATE INDEX "payout_transactions_providerTxId_idx" ON "payout_transactions"("providerTxId");

-- CreateIndex
CREATE INDEX "fraud_flags_userId_status_idx" ON "fraud_flags"("userId", "status");

-- CreateIndex
CREATE INDEX "fraud_flags_deviceId_status_idx" ON "fraud_flags"("deviceId", "status");

-- CreateIndex
CREATE INDEX "fraud_flags_campaignId_status_idx" ON "fraud_flags"("campaignId", "status");

-- CreateIndex
CREATE INDEX "fraud_flags_flagType_severity_idx" ON "fraud_flags"("flagType", "severity");

-- CreateIndex
CREATE INDEX "fraud_flags_status_createdAt_idx" ON "fraud_flags"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "trust_scores_userId_key" ON "trust_scores"("userId");

-- CreateIndex
CREATE INDEX "campaign_approvals_campaignId_idx" ON "campaign_approvals"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_ownerId_idx" ON "api_keys"("ownerId");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");

-- CreateIndex
CREATE INDEX "webhook_events_provider_eventType_idx" ON "webhook_events"("provider", "eventType");

-- CreateIndex
CREATE INDEX "webhook_events_processingStatus_idx" ON "webhook_events"("processingStatus");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_code_key" ON "referrals"("code");

-- CreateIndex
CREATE INDEX "referrals_referrerId_idx" ON "referrals"("referrerId");

-- CreateIndex
CREATE INDEX "referrals_referredId_idx" ON "referrals"("referredId");

-- CreateIndex
CREATE INDEX "referral_rewards_referralId_idx" ON "referral_rewards"("referralId");

-- CreateIndex
CREATE INDEX "referral_rewards_userId_idx" ON "referral_rewards"("userId");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_categories" ADD CONSTRAINT "blocked_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_targeting" ADD CONSTRAINT "country_targeting_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_state_events" ADD CONSTRAINT "wait_state_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wait_state_events" ADD CONSTRAINT "wait_state_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_impressions" ADD CONSTRAINT "ad_impressions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_impressionId_fkey" FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_impressionId_fkey" FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "ad_creatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_reports" ADD CONSTRAINT "ad_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_impressionId_fkey" FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "ad_clicks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertiser_ledger" ADD CONSTRAINT "advertiser_ledger_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_payoutAccountId_fkey" FOREIGN KEY ("payoutAccountId") REFERENCES "payout_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES "payout_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_earningsEntryId_fkey" FOREIGN KEY ("earningsEntryId") REFERENCES "earnings_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_payoutRequestId_fkey" FOREIGN KEY ("payoutRequestId") REFERENCES "payout_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_impressionId_fkey" FOREIGN KEY ("impressionId") REFERENCES "ad_impressions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "ad_clicks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_approvals" ADD CONSTRAINT "campaign_approvals_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "advertisers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


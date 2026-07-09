import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

// ── Shared signing utility (no mocking needed — it's pure crypto) ──
import { signPayload } from '@waitlayer/shared';

import { AdminService } from '../admin/admin.service';
import { AdvertiserService } from '../advertiser/advertiser.service';
import { AuditService } from '../audit/audit.service';
import { CampaignService } from '../campaign/campaign.service';
import { ComplianceService } from '../compliance/compliance.service';
import { DeveloperService } from '../developer/developer.service';
import { ExtensionService } from '../extension/extension.service';
import { FraudService } from '../fraud/fraud.service';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutService } from '../payout/payout.service';

// HMAC secret must match what ExtensionService uses
const HMAC_SECRET = 'dev-secret-change-me-do-not-use-in-production';
const DEVICE_EVENT_SECRET = 'test-device-event-secret-for-signing';

// ── Helpers ──
function hmacSign(payload: Record<string, unknown>, secret = DEVICE_EVENT_SECRET): string {
  return signPayload(payload, secret);
}

// ── Prisma mock ──
//
// This mock covers every table touched by the 6 services wired together.
// Each method is a vi.fn() so we can assert calls and return values.
const mockPrisma = {
  // ── User ──
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  // ── Advertiser ──
  advertiser: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  // ── Campaign ──
  campaign: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
  },
  // ── AdCreative ──
  adCreative: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  // ── CampaignApproval ──
  campaignApproval: {
    create: vi.fn(),
  },
  // ── CountryTargeting ──
  countryTargeting: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  // ── BlockedCategory ──
  blockedCategory: {
    findFirst: vi.fn(),
  },
  // ── Category ──
  category: {},
  // ── Device ──
  device: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  // ── DeviceRecoveryToken ──
  deviceRecoveryToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  // ── RecoveryDebtCase ──
  recoveryDebtCase: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  // ── UserSettings ──
  userSettings: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  // ── TrustScore ──
  trustScore: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  // ── FraudFlag ──
  fraudFlag: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  // ── Impression / AdImpression ──
  impression: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  adImpression: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    // recordQualifiedImpression's CPM branch now uses a conditional
    // updateMany CAS (where qualifiedAt IS NULL) to claim the impression
    // before writing ledger rows. Default to "claim won" ({count:1}) so the
    // existing happy-path tests proceed to the ledger writes.
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
  },
  // ── AdClick ──
  adClick: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  // ── AdReport ──
  adReport: {
    create: vi.fn(),
  },
  // ── WaitStateEvent ──
  waitStateEvent: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    groupBy: vi.fn(),
  },
  // ── EarningsLedger ──
  earningsLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  // ── AdvertiserLedger ──
  advertiserLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(async (args?: any) => {
      const advertiserId =
        args?.where?.advertiserId?.in?.[0] || args?.where?.advertiserId || 'default-adv';
      // The mock must include `currency` in every returned row so the per-currency
      // balance helpers (`getAdvertiserBalancesByCurrency`, `getAdvertiserBalance`)
      // can compose `advertiserId:currency` keys and match campaigns by currency.
      const currency = args?.where?.currency || 'USD';
      return [
        {
          advertiserId,
          currency,
          entryType: 'credit',
          _sum: { amountMinor: 10000_00 },
        },
      ];
    }),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  // ── PlatformLedger ──
  platformLedger: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  // ── PayoutRequest ──
  payoutRequest: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    update: vi.fn(),
  },
  // ── PayoutTransaction ──
  payoutTransaction: {
    create: vi.fn(),
  },
  // ── PayoutAccount ──
  payoutAccount: {
    findMany: vi.fn(),
  },
  // ── AuditLog ──
  auditLog: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  // ── Session ──
  session: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  // ── Referral ──
  referral: {
    create: vi.fn(),
  },

  // ── Consent (A-034 / A-036) ──
  consent: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  // ── Retention (ComplianceService.purge / ensureRetentionDefaults) ──
  dataRetentionConfig: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  webhookEvent: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },

  // Raw SQL — used for atomic budget guards. Default return = 1 (row updated).
  $executeRawUnsafe: vi.fn(async (_sql: string, ..._params: any[]) => 1),
  $executeRaw: vi.fn(async (_tpl: any, ..._vals: any[]) => 1),

  // $transaction — mimic the real one: accepts either array or callback
  $transaction: vi.fn(async (arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) {
      return Promise.all(arg.map(async (fn: any) => (typeof fn === 'function' ? fn() : fn)));
    }
    return arg;
  }),
};

const prismaRef = mockPrisma as any;
const mockGoogleVerifier = {
  verify: vi.fn(),
};

// ── Shared in-memory ledger for cross-service assertions ──
// Some ledger entries are created inside $transaction callbacks; we need
// to capture them so we can assert on amounts and statuses after the flow.
const recordedLedgerEntries: {
  advertiser: any[];
  earnings: any[];
  platform: any[];
} = {
  advertiser: [],
  earnings: [],
  platform: [],
};

function installLedgerCapture() {
  recordedLedgerEntries.advertiser = [];
  recordedLedgerEntries.earnings = [];
  recordedLedgerEntries.platform = [];

  // When PrismaService methods are called, capture the `data` argument
  mockPrisma.advertiserLedger.create.mockImplementation((args: any) => {
    recordedLedgerEntries.advertiser.push(args.data);
    return Promise.resolve({
      id: 'adv-ledger-' + recordedLedgerEntries.advertiser.length,
      ...args.data,
    });
  });
  mockPrisma.earningsLedger.create.mockImplementation((args: any) => {
    recordedLedgerEntries.earnings.push(args.data);
    return Promise.resolve({
      id: 'earn-ledger-' + recordedLedgerEntries.earnings.length,
      ...args.data,
    });
  });
  mockPrisma.platformLedger.create.mockImplementation((args: any) => {
    recordedLedgerEntries.platform.push(args.data);
    return Promise.resolve({
      id: 'plat-ledger-' + recordedLedgerEntries.platform.length,
      ...args.data,
    });
  });
}

// ── Test fixture builder ──

interface TestFixtures {
  extension: ExtensionService;
  ledger: LedgerService;
  fraud: FraudService;
  campaign: CampaignService;
  advertiser: AdvertiserService;
  admin: AdminService;
  audit: AuditService;
  payout: PayoutService;
  developer: DeveloperService;
}

function makeServices(): TestFixtures {
  // AuditService — real instance (its prisma is mocked)
  const audit = new AuditService(prismaRef);

  // LedgerService — real instance with mocked prisma
  const ledger = new LedgerService(prismaRef);

  // FraudService — real instance with mocked prisma and real ledger
  const fraud = new FraudService(prismaRef, ledger);

  // ComplianceService — real instance with mocked prisma and real audit (A-036
  // wires extension.requestAd to check `ccpa_opt_out` via compliance.isConsented).
  const compliance = new ComplianceService(prismaRef, audit);

  // ExtensionService — real instance with all mocked deps
  const extension = new ExtensionService(
    prismaRef,
    audit,
    ledger,
    fraud,
    compliance,
    mockGoogleVerifier as any,
  );

  // CampaignService — real instance with mocked prisma + real audit (audit is fire-and-forget; safe to share)
  const campaign = new CampaignService(prismaRef, audit);

  // AdvertiserService — real instance with mocked prisma and real campaign service + audit
  // (A-044 added the GoogleTokenVerifier dep so deleteAccount can step-up reauth Google-only accounts.)
  const advertiser = new AdvertiserService(prismaRef, campaign, audit, mockGoogleVerifier as any);

  // PayoutService — real instance with mocked prisma, real ledger + audit, dummy paypal payouts provider
  const payoutConfig = {
    get: vi.fn((key: string, fallback?: string) => {
      if (key === 'PAYOUT_REQUIRE_2FA') return 'false';
      return fallback ?? undefined;
    }),
  } as any;
  const payout = new PayoutService(
    prismaRef,
    ledger,
    {} as any,
    audit,
    payoutConfig,
    {} as any,
    {} as any,
    {} as any,
  );

  const developer = new DeveloperService(prismaRef, fraud, audit, mockGoogleVerifier as any);

  // AdminService — real instance with mocked prisma and real audit service and payout service
  const admin = new AdminService(prismaRef, audit, payout, fraud, developer);

  return { extension, ledger, fraud, campaign, advertiser, admin, audit, payout, developer };
}

// ── ID helpers ──
let idCounter = 0;
function uid(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

// ── Tests ──

describe('E2E Money Loop', () => {
  let svc: TestFixtures;

  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    recordedLedgerEntries.advertiser = [];
    recordedLedgerEntries.earnings = [];
    recordedLedgerEntries.platform = [];
    svc = makeServices();
    installLedgerCapture();

    // Default mock for advertiser balance to prevent requestAd / billing checks failing.
    // The balance helper (getAdvertiserBalancesByCurrency / getAdvertiserBalance) groups
    // by advertiserId:currency:entryType and subtracts debits/refunds, so the mocked rows
    // must include currency (USD) and a confirmed credit for every requested advertiser.
    mockPrisma.advertiserLedger.groupBy.mockImplementation(async (args?: any) => {
      const ids: string[] =
        args?.where?.advertiserId?.in ??
        (args?.where?.advertiserId ? [args.where.advertiserId] : ['default-adv']);
      return ids.map((advertiserId) => ({
        advertiserId,
        currency: 'USD',
        entryType: 'credit',
        _sum: { amountMinor: 10000_00 },
      }));
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 1: Campaign creation and approval
  // ──────────────────────────────────────────────────────────────

  describe('Phase 1: Campaign lifecycle (create → approve → active)', () => {
    it('creates advertiser profile, campaign, creative; admin approves creative and campaign', async () => {
      const advertiserUserId = uid('u');
      const advertiserProfileId = uid('adv');
      const campaignId = uid('camp');
      const creativeId = uid('cr');

      // --- Step 1: Create advertiser profile ---
      mockPrisma.advertiser.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: advertiserUserId,
        email: 'biz@example.com',
        name: 'Acme Corp',
        role: 'advertiser',
        status: 'active',
      });
      mockPrisma.advertiser.create.mockResolvedValue({
        id: advertiserProfileId,
        userId: advertiserUserId,
        companyName: 'Acme Corp',
        billingEmail: 'biz@example.com',
      });

      const profile = await svc.advertiser.createProfile(advertiserUserId, {
        companyName: 'Acme Corp',
        billingEmail: 'biz@example.com',
      });
      expect(profile.id).toBe(advertiserProfileId);

      // --- Step 2: Create campaign (draft) ---
      mockPrisma.blockedCategory.findFirst.mockResolvedValue(null);
      mockPrisma.campaign.create.mockResolvedValue({
        id: campaignId,
        advertiserId: advertiserProfileId,
        name: 'Test Campaign',
        category: 'developer_tools',
        bidType: 'cpm',
        bidAmountMinor: 2_00,
        budgetTotalMinor: 100_00, // $1.00 budget
        budgetSpentMinor: 0,
        currency: 'USD',
        status: 'draft',
        frequencyCapPerHour: 2,
        frequencyCapPerDay: 6,
        qualityScore: null,
        submittedAt: null,
        approvedAt: null,
        activatedAt: null,
        pausedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const campaign = await svc.advertiser.createCampaign(advertiserProfileId, {
        name: 'Test Campaign',
        category: 'developer_tools',
        bidType: 'cpm',
        bidAmountMinor: 2_00,
        budgetTotalMinor: 100_00,
      });
      expect(campaign.id).toBe(campaignId);
      expect(campaign.status).toBe('draft');

      // --- Step 3: Create creative (draft) ---
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        status: 'draft',
      });
      mockPrisma.adCreative.create.mockResolvedValue({
        id: creativeId,
        campaignId,
        title: 'Best AI Tools',
        sponsoredMessage: 'Try our AI-powered code completion — free for 30 days!',
        destinationUrl: 'https://example.com/ai-tools',
        displayDomain: 'example.com',
        status: 'draft',
        rejectionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const creative = await svc.campaign.createCreative(
        campaignId,
        {
          title: 'Best AI Tools',
          sponsoredMessage: 'Try our AI-powered code completion — free for 30 days!',
          destinationUrl: 'https://example.com/ai-tools',
          displayDomain: 'example.com',
        },
        { role: 'admin' },
      );
      expect(creative.id).toBe(creativeId);

      // --- Step 4: Admin approves creative ---
      // Reset campaign.findUnique for approveCreative's internal check
      mockPrisma.adCreative.findUnique.mockResolvedValue({
        id: creativeId,
        campaignId,
        title: 'Best AI Tools',
        status: 'draft',
      });
      mockPrisma.adCreative.update.mockResolvedValue({
        id: creativeId,
        campaignId,
        status: 'approved',
      });

      // approveCreative checks campaign status + creatives
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        status: 'draft',
        creatives: [{ id: creativeId, status: 'approved' }],
      });

      const approveResult = await svc.campaign.approveCreative(creativeId);
      expect(approveResult.creative.status).toBe('approved');

      // --- Step 5: Advertiser submits campaign ---
      // Reset campaign.findUnique for submitCampaign (must include creatives)
      mockPrisma.campaign.findUnique
        .mockResolvedValueOnce({
          id: campaignId,
          advertiserId: advertiserProfileId,
          status: 'draft',
          creatives: [{ id: creativeId, status: 'approved' }],
          submittedAt: null,
        })
        .mockResolvedValueOnce({
          id: campaignId,
          advertiserId: advertiserProfileId,
          status: 'submitted',
          submittedAt: new Date(),
        });
      mockPrisma.campaign.updateMany.mockResolvedValue({ count: 1 });

      const submitted = await svc.advertiser.submitCampaign(campaignId, advertiserProfileId);
      expect(submitted.status).toBe('submitted');

      // --- Step 6: Admin approves campaign (→ active because approved creative exists) ---
      // approveCampaign fetches once (status guard) then re-reads inside the
      // tx after the CAS flip. The second findUnique must reflect the flipped
      // status='active' (the mock is a queue — last queued wins).
      mockPrisma.campaign.findUnique
        .mockResolvedValueOnce({
          id: campaignId,
          status: 'submitted',
          budgetSpentMinor: 0,
          budgetTotalMinor: 50000,
          creatives: [{ id: creativeId, status: 'approved' }],
        })
        .mockResolvedValueOnce({
          id: campaignId,
          status: 'active',
          approvedAt: new Date(),
          activatedAt: new Date(),
          creatives: [{ id: creativeId, status: 'approved' }],
        });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campaignId,
        status: 'active',
        approvedAt: new Date(),
        activatedAt: new Date(),
      });
      mockPrisma.campaignApproval.create.mockResolvedValue({
        id: uid('ca'),
        campaignId,
        reviewerId: 'admin-1',
        decision: 'approved',
      });

      // approveCampaign transactions: callback returns { campaign: freshCampaign }
      // matching the post-CAS findUnique re-read.
      mockPrisma.$transaction.mockImplementationOnce(async (arg: any) => {
        if (typeof arg === 'function') return arg(mockPrisma);
        return {
          campaign: {
            id: campaignId,
            status: 'active',
            approvedAt: new Date(),
            activatedAt: new Date(),
          },
        };
      });

      const result = await svc.admin.approveCampaign(campaignId, 'admin-1');
      // approveCampaign now returns { campaign, activated, status, blockers }
      expect(result.activated).toBe(true);
      expect(result.campaign.status).toBe('active');
    });
  });

  describe('Advertiser billing', () => {
    it('reports advertiser-ledger balance matching the centralized spendable-balance formula (credits − debits − refunds) (A-066)', async () => {
      const advertiserId = uid('adv');
      const createdAt = new Date('2026-07-07T00:00:00.000Z');

      mockPrisma.advertiser.findUnique.mockResolvedValue({ id: advertiserId });
      mockPrisma.advertiserLedger.groupBy.mockResolvedValue([
        { currency: 'USD', entryType: 'credit', _sum: { amountMinor: 10_000 } },
        { currency: 'USD', entryType: 'debit', _sum: { amountMinor: 2_500 } },
        { currency: 'USD', entryType: 'refund', _sum: { amountMinor: 500 } },
      ]);
      mockPrisma.advertiserLedger.findMany.mockResolvedValue([
        {
          id: uid('al'),
          campaignId: null,
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: 10_000,
          currency: 'USD',
          description: 'Stripe deposit',
          stripePaymentIntentId: 'pi_123',
          stripeDisputeId: null,
          createdAt,
        },
        {
          id: uid('al'),
          campaignId: uid('camp'),
          entryType: 'refund',
          status: 'confirmed',
          amountMinor: 500,
          currency: 'USD',
          description: 'Stripe refund',
          stripePaymentIntentId: 'pi_123',
          stripeDisputeId: null,
          createdAt,
        },
        {
          id: uid('al'),
          campaignId: uid('camp'),
          entryType: 'debit',
          status: 'confirmed',
          amountMinor: 2_500,
          currency: 'USD',
          description: 'Campaign spend',
          stripePaymentIntentId: null,
          stripeDisputeId: null,
          createdAt,
        },
      ]);

      const result = await svc.advertiser.getBilling(advertiserId);

      // 10_000 − 2_500 − 500 = 7_000 (A-066: refunds reduce displayed balance)
      expect(result.balanceMinor).toBe(7_000);
      expect(result.totalDepositsMinor).toBe(10_000);
      expect(result.totalChargesMinor).toBe(2_500);
      expect(result.totalRefundsMinor).toBe(500);
      expect(result.balances).toEqual([
        {
          currency: 'USD',
          balanceMinor: 7_000,
          totalDepositsMinor: 10_000,
          totalChargesMinor: 2_500,
          totalRefundsMinor: 500,
        },
      ]);
      expect(result.entries).toHaveLength(3);
      expect(mockPrisma.advertiserLedger.groupBy).toHaveBeenCalledWith({
        by: ['currency', 'entryType'],
        where: {
          advertiserId,
          entryType: { in: ['credit', 'debit', 'refund'] },
          status: 'confirmed',
        },
        _sum: { amountMinor: true },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 2: Device registration + wait-state + ad request
  // ──────────────────────────────────────────────────────────────

  describe('Phase 2: Device registration, wait-state, ad request', () => {
    const DEV_USER_ID = uid('dev');
    const ADS_USER_ID = uid('adv-u');
    const ADS_PROFILE_ID = uid('adv-p');
    const CAMPAIGN_ID = uid('camp');
    const CREATIVE_ID = uid('cr');
    const DEVICE_ID = uid('dev');
    const SESSION_ID = uid('sess');
    const WAIT_STATE_ID = uid('ws');

    beforeEach(() => {
      // Advertiser balance: credit of 1000 USD
      mockPrisma.advertiserLedger.groupBy.mockResolvedValue([
        {
          advertiserId: ADS_PROFILE_ID,
          currency: 'USD',
          entryType: 'credit',
          _sum: { amountMinor: 1000_00 },
        },
      ]);
      // Pre-seed the "developer" user and "advertiser" user exists
      mockPrisma.user.findUnique.mockImplementation((args: any) => {
        if (args?.where?.id === DEV_USER_ID || args?.where?.id === ADS_USER_ID) {
          return Promise.resolve({
            id: args.where.id,
            email: args.where.id === DEV_USER_ID ? 'dev@test.com' : 'biz@test.com',
            name: args.where.id === DEV_USER_ID ? 'Dev User' : 'Biz User',
            role: args.where.id === DEV_USER_ID ? 'developer' : 'advertiser',
            status: 'active',
          });
        }
        return Promise.resolve(null);
      });
    });

    it('registers a device', async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null); // not already registered
      mockPrisma.device.findFirst.mockResolvedValue(null); // no duplicate fingerprint
      mockPrisma.device.create.mockResolvedValue({
        id: DEVICE_ID,
        userId: DEV_USER_ID,
        fingerprintHash: 'fp-hash-abc',
        toolType: 'claude_code',
        extensionVersion: '1.0.0',
        platform: 'linux',
        publicKey: null,
        lastSeenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const device = await svc.extension.registerDevice(DEV_USER_ID, {
        toolType: 'claude_code',
        fingerprintHash: 'fp-hash-abc',
        extensionVersion: '1.0.0',
        platform: 'linux',
      });
      expect(device.id).toBe(DEVICE_ID);
      expect(device.userId).toBe(DEV_USER_ID);
    });

    it('records wait-state-start', async () => {
      // Device ownership check
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: DEV_USER_ID,
        eventSecret: DEVICE_EVENT_SECRET,
        fingerprintHash: 'fp-hash-abc',
        toolType: 'claude_code',
      });

      // Not already idempotent
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue(null);

      mockPrisma.waitStateEvent.create.mockResolvedValue({
        id: uid('wse'),
        userId: DEV_USER_ID,
        deviceId: DEVICE_ID,
        sessionId: SESSION_ID,
        eventType: 'wait_state_start',
        waitStateId: WAIT_STATE_ID,
        toolType: 'claude_code',
        idempotencyKey: 'idem-ws-start-1',
        signature: 'sig',
        createdAt: new Date(),
      });

      const payload = {
        deviceId: DEVICE_ID,
        sessionId: SESSION_ID,
        toolType: 'claude_code',
        waitStateId: WAIT_STATE_ID,
        idempotencyKey: 'idem-ws-start-1',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const event = await svc.extension.recordWaitStateStart(DEV_USER_ID, signed);
      expect(event.eventType).toBe('wait_state_start');
    });

    it('requests an ad and returns an impression token', async () => {
      // User settings: ads enabled
      mockPrisma.userSettings.findUnique.mockResolvedValue({
        userId: DEV_USER_ID,
        adsEnabled: true,
      });

      // Device ownership
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: DEV_USER_ID,
        eventSecret: DEVICE_EVENT_SECRET,
        user: { status: 'active' },
      });

      mockPrisma.waitStateEvent.findFirst.mockImplementation(({ where }: any) => {
        if (where.eventType === 'wait_state_start') {
          return Promise.resolve({
            userId: DEV_USER_ID,
            deviceId: DEVICE_ID,
            sessionId: SESSION_ID,
            waitStateId: WAIT_STATE_ID,
            eventType: 'wait_state_start',
            createdAt: new Date(Date.now() - 1000),
          });
        }
        return Promise.resolve(null);
      });

      // No existing impression (no idempotency cache)
      mockPrisma.adImpression.findFirst.mockResolvedValue(null);

      // Frequency cap: recent impressions (none)
      mockPrisma.adImpression.findMany.mockResolvedValue([]);

      // Active campaigns with approved creatives
      mockPrisma.campaign.findMany.mockResolvedValue([
        {
          id: CAMPAIGN_ID,
          advertiserId: ADS_PROFILE_ID,
          name: 'Test Campaign',
          status: 'active',
          category: 'developer_tools',
          bidType: 'cpm',
          bidAmountMinor: 2_00,
          budgetTotalMinor: 1_000_00,
          budgetSpentMinor: 0,
          currency: 'USD',
          frequencyCapPerHour: 2,
          frequencyCapPerDay: 6,
          creatives: [
            {
              id: CREATIVE_ID,
              campaignId: CAMPAIGN_ID,
              title: 'Best AI Tools',
              sponsoredMessage: 'Try our AI-powered code completion!',
              displayDomain: 'example.com',
              destinationUrl: 'https://example.com/ai-tools',
              status: 'approved',
            },
          ],
          countryTargeting: [],
        },
      ]);

      // Create impression record
      mockPrisma.adImpression.create.mockResolvedValue({
        id: uid('imp'),
        campaignId: CAMPAIGN_ID,
        creativeId: CREATIVE_ID,
        userId: DEV_USER_ID,
        deviceId: DEVICE_ID,
        sessionId: SESSION_ID,
        impressionTokenHash: 'will-be-set-by-service',
        isBillable: false,
        createdAt: new Date(),
      });

      const payload = {
        deviceId: DEVICE_ID,
        sessionId: SESSION_ID,
        waitStateId: WAIT_STATE_ID,
        toolType: 'claude_code',
        idempotencyKey: 'idem-ad-req-1',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.requestAd(DEV_USER_ID, signed);
      expect(result.ad).toBeDefined();
      expect(result.ad.impressionToken).toBeDefined();
      expect(result.ad.campaignId).toBe(CAMPAIGN_ID);
      expect(result.ad.creativeId).toBe(CREATIVE_ID);
      expect(result.ad.title).toBe('Best AI Tools');
      expect(result.ad.label).toBe('Sponsored');
      expect(result.ad.destinationUrl).toBe('https://example.com/ai-tools');
    });

    it('does not serve ads to restricted developer accounts', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: DEV_USER_ID,
        eventSecret: DEVICE_EVENT_SECRET,
        user: { status: 'restricted' },
      });

      const payload = {
        deviceId: DEVICE_ID,
        sessionId: SESSION_ID,
        waitStateId: WAIT_STATE_ID,
        toolType: 'claude_code',
        idempotencyKey: 'idem-ad-req-restricted',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.requestAd(DEV_USER_ID, signed);
      expect(result).toEqual({ ad: null, reason: 'account_not_active' });
      expect(mockPrisma.device.findUnique).toHaveBeenCalled();
      expect(mockPrisma.campaign.findMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 3: Qualified impression — the money moves
  // ──────────────────────────────────────────────────────────────

  describe('Phase 3: Qualified impression triggers full ledger write', () => {
    const DEV_USER_ID = uid('dev');
    const ADS_PROFILE_ID = uid('adv-p');
    const CAMPAIGN_ID = uid('camp');
    const IMPRESSION_ID = uid('imp');
    const IMPRESSION_TOKEN = 'test-impression-token-12345';
    const DEVICE_ID = uid('dev');

    beforeEach(() => {
      // Fraud rate limit: under 60/hour
      mockPrisma.adImpression.count.mockResolvedValue(5);

      // Trust score: normal trust → 14 day hold
      mockPrisma.trustScore.findUnique.mockResolvedValue({
        userId: DEV_USER_ID,
        score: 55,
        level: 'normal',
      });

      // Impression lookup by token hash
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: IMPRESSION_ID,
        campaignId: CAMPAIGN_ID,
        creativeId: uid('cr'),
        userId: DEV_USER_ID,
        deviceId: DEVICE_ID,
        sessionId: uid('sess'),
        impressionTokenHash: require('crypto')
          .createHash('sha256')
          .update(IMPRESSION_TOKEN)
          .digest('hex'),
        renderedAt: new Date(Date.now() - 6000),
        qualifiedAt: null,
        visibleDurationMs: null,
        isBillable: false,
        campaign: {
          id: CAMPAIGN_ID,
          bidAmountMinor: 2_00,
          currency: 'USD',
          advertiserId: ADS_PROFILE_ID,
          bidType: 'cpm',
        },
        user: { status: 'active' },
      });

      // Impression update (mark billable)
      mockPrisma.adImpression.update.mockResolvedValue({
        id: IMPRESSION_ID,
        isBillable: true,
        qualifiedAt: new Date(),
        visibleDurationMs: 7500,
      });

      // Campaign spend update
      mockPrisma.campaign.update.mockResolvedValue({
        id: CAMPAIGN_ID,
        budgetSpentMinor: 2_00,
      });

      // Ledger creates captured via installLedgerCapture()
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: DEV_USER_ID,
        eventSecret: DEVICE_EVENT_SECRET,
      });
    });

    it('qualifies an impression and creates all 5 ledger entries + campaign spend increment', async () => {
      // Override $transaction for this specific test to actually simulate the transaction
      // The real ExtensionService passes an array of 6 operations to $transaction
      mockPrisma.$transaction.mockImplementationOnce(async (arg: any) => {
        if (Array.isArray(arg)) {
          // Execute all operations in the array to trigger our capture mocks
          const results = [];
          for (const fn of arg) {
            results.push(await (typeof fn === 'function' ? fn() : fn));
          }
          return results;
        }
        if (typeof arg === 'function') return arg(mockPrisma);
        return arg;
      });

      const payload = {
        impressionToken: IMPRESSION_TOKEN,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 7500,
        idempotencyKey: 'idem-qual-1',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordQualifiedImpression(DEV_USER_ID, signed);
      expect(result.qualified).toBe(true);
      expect(result.impressionId).toBe(IMPRESSION_ID);

      // Verify ledger entries were captured
      // (1) Advertiser debit
      const advEntries = recordedLedgerEntries.advertiser;
      expect(advEntries.length).toBeGreaterThanOrEqual(1);
      const advDebit = advEntries.find((e: any) => e.entryType === 'debit');
      expect(advDebit).toBeDefined();
      expect(advDebit.advertiserId).toBe(ADS_PROFILE_ID);
      expect(advDebit.campaignId).toBe(CAMPAIGN_ID);
      expect(advDebit.amountMinor).toBe(2_00); // full bid charged to advertiser
      expect(advDebit.status).toBe('confirmed');

      // (2) Developer earnings credit (estimated, with future availableAt)
      const earnEntries = recordedLedgerEntries.earnings;
      expect(earnEntries.length).toBeGreaterThanOrEqual(1);
      const devCredit = earnEntries.find((e: any) => e.entryType === 'credit');
      expect(devCredit).toBeDefined();
      expect(devCredit.userId).toBe(DEV_USER_ID);
      expect(devCredit.impressionId).toBe(IMPRESSION_ID);
      expect(devCredit.status).toBe('estimated');
      expect(devCredit.amountMinor).toBe(120); // 60% of 200 cents = 120
      expect(devCredit.availableAt).toBeDefined(); // future date for hold

      // (3) Platform fee (confirmed)
      const platEntries = recordedLedgerEntries.platform;
      expect(platEntries.length).toBeGreaterThanOrEqual(2);
      const platFee = platEntries.find((e: any) => e.bucket === 'platform_fee');
      expect(platFee).toBeDefined();
      expect(platFee.amountMinor).toBe(60); // 30% of 200 cents
      expect(platFee.status).toBe('confirmed');

      // (4) Fraud reserve (confirmed)
      const reserve = platEntries.find((e: any) => e.bucket === 'fraud_reserve');
      expect(reserve).toBeDefined();
      expect(reserve.amountMinor).toBe(20); // 10% of 200 cents
      expect(reserve.status).toBe('confirmed');
    });

    it('rejects qualification under minimum visible duration', async () => {
      const payload = {
        impressionToken: IMPRESSION_TOKEN,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 2000, // below 5000ms minimum
        idempotencyKey: 'idem-qual-short',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordQualifiedImpression(DEV_USER_ID, signed);
      expect(result.qualified).toBe(false);
      expect(result.reason).toBe('minimum_duration_not_met');
      expect(result.minimumRequired).toBe(5000);
    });

    it('marks impression as non-billable when fraud rate limit exceeded', async () => {
      // Fraud rate limit: blocked
      mockPrisma.adImpression.count.mockResolvedValue(61); // over 60 limit

      mockPrisma.adImpression.update.mockResolvedValue({
        id: IMPRESSION_ID,
        isBillable: false,
        qualifiedAt: new Date(),
        visibleDurationMs: 6000,
      });

      const payload = {
        impressionToken: IMPRESSION_TOKEN,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: 'idem-qual-blocked',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordQualifiedImpression(DEV_USER_ID, signed);
      expect(result.qualified).toBe(false);
      expect(result.reason).toMatch(/fraud|limit/i);
    });

    it('marks impression as non-billable when the developer account is restricted', async () => {
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: IMPRESSION_ID,
        campaignId: CAMPAIGN_ID,
        creativeId: uid('cr'),
        userId: DEV_USER_ID,
        deviceId: DEVICE_ID,
        sessionId: uid('sess'),
        impressionTokenHash: require('crypto')
          .createHash('sha256')
          .update(IMPRESSION_TOKEN)
          .digest('hex'),
        renderedAt: new Date(Date.now() - 6000),
        qualifiedAt: null,
        visibleDurationMs: null,
        isBillable: false,
        campaign: {
          id: CAMPAIGN_ID,
          bidAmountMinor: 2_00,
          currency: 'USD',
          advertiserId: ADS_PROFILE_ID,
          bidType: 'cpm',
        },
        user: { status: 'restricted' },
      });
      mockPrisma.adImpression.update.mockResolvedValue({
        id: IMPRESSION_ID,
        isBillable: false,
        qualifiedAt: new Date(),
        visibleDurationMs: 6000,
        invalidationReason: 'account_not_active',
      });

      const payload = {
        impressionToken: IMPRESSION_TOKEN,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: 'idem-qual-restricted',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordQualifiedImpression(DEV_USER_ID, signed);
      expect(result).toMatchObject({
        qualified: false,
        impressionId: IMPRESSION_ID,
        reason: 'account_not_active',
      });
      expect(recordedLedgerEntries.advertiser).toHaveLength(0);
      expect(recordedLedgerEntries.earnings).toHaveLength(0);
      expect(recordedLedgerEntries.platform).toHaveLength(0);
      expect(mockPrisma.adImpression.update).toHaveBeenCalledWith({
        where: { id: IMPRESSION_ID },
        data: expect.objectContaining({
          isBillable: false,
          invalidationReason: 'account_not_active',
        }),
      });
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 4: Click tracking (CPC campaigns)
  // ──────────────────────────────────────────────────────────────

  describe('Phase 4: Click tracking with ledger entries for CPC', () => {
    const DEV_USER_ID = uid('dev');
    const ADS_PROFILE_ID = uid('adv-p');
    const CAMPAIGN_ID = uid('camp');
    const IMPRESSION_ID = uid('imp');
    const IMPRESSION_TOKEN = 'test-click-token-67890';

    beforeEach(() => {
      // Impression lookup
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: IMPRESSION_ID,
        campaignId: CAMPAIGN_ID,
        creativeId: uid('cr'),
        userId: DEV_USER_ID,
        deviceId: uid('dev'),
        sessionId: uid('sess'),
        impressionTokenHash: require('crypto')
          .createHash('sha256')
          .update(IMPRESSION_TOKEN)
          .digest('hex'),
        qualifiedAt: new Date(),
        campaign: {
          id: CAMPAIGN_ID,
          bidAmountMinor: 3_00,
          currency: 'USD',
          advertiserId: ADS_PROFILE_ID,
          bidType: 'cpc',
        },
        user: { status: 'active' },
      });
      mockPrisma.adCreative.findUnique.mockResolvedValue({
        destinationUrl: 'https://click.example.com/offer',
      });

      // No existing click (idempotency)
      mockPrisma.adClick.findUnique.mockResolvedValue(null);
      mockPrisma.adClick.findFirst.mockResolvedValue(null);

      // Fraud click patterns: allowed
      // First adClick.count call: duplicate check (must be 0)
      // Second adClick.count call: rate limit (5 clicks/hour is fine)
      mockPrisma.adClick.count
        .mockResolvedValueOnce(0) // no existing click for this impression
        .mockResolvedValueOnce(5); // 5 clicks in last hour (under 30 limit)
      mockPrisma.adImpression.count.mockResolvedValue(10); // 10 impressions → CTR 50%, not >50%

      // Self-click check: developer is NOT the advertiser
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: CAMPAIGN_ID,
        advertiser: { userId: 'different-advertiser-user-id' }, // not DEV_USER_ID
      });

      // Trust level
      mockPrisma.trustScore.findUnique.mockResolvedValue({
        userId: DEV_USER_ID,
        score: 55,
        level: 'normal',
      });

      // Click creation
      mockPrisma.adClick.create.mockResolvedValue({
        id: uid('clk'),
        impressionId: IMPRESSION_ID,
        userId: DEV_USER_ID,
        campaignId: CAMPAIGN_ID,
        clickedAt: new Date(),
      });
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'click-device',
        userId: DEV_USER_ID,
        eventSecret: DEVICE_EVENT_SECRET,
      });

      installLedgerCapture();
    });

    it('creates click and ledger entries for CPC campaign', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (arg: any) => {
        if (Array.isArray(arg)) {
          const results = [];
          for (const fn of arg) {
            results.push(await (typeof fn === 'function' ? fn() : fn));
          }
          return results;
        }
        if (typeof arg === 'function') return arg(mockPrisma);
        return arg;
      });

      const payload = {
        impressionToken: IMPRESSION_TOKEN,
        clickedAt: new Date().toISOString(),
        idempotencyKey: 'idem-click-1',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordClick(DEV_USER_ID, signed);
      expect(result.clicked).toBe(true);
      const clickId = result.clickId;
      expect(mockPrisma.adClick.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ targetUrl: 'https://click.example.com/offer' }),
        }),
      );

      // CPC campaigns generate advertiser debit + developer credit + platform fee + reserve
      const advDebit = recordedLedgerEntries.advertiser.find((e: any) => e.entryType === 'debit');
      expect(advDebit).toBeDefined();
      expect(advDebit.amountMinor).toBe(3_00);

      const devCredit = recordedLedgerEntries.earnings.find((e: any) => e.entryType === 'credit');
      expect(devCredit).toBeDefined();
      expect(devCredit.status).toBe('estimated');
      expect(devCredit.amountMinor).toBe(180); // 60% of 300
      expect(devCredit.clickId).toBe(clickId);

      const platformEntry = recordedLedgerEntries.platform.find(
        (e: any) => e.bucket === 'platform_fee',
      );
      expect(platformEntry).toBeDefined();
      expect(platformEntry.amountMinor).toBe(90); // 30% of 300
      expect(platformEntry.referenceId).toBe(clickId);

      const reserveEntry = recordedLedgerEntries.platform.find(
        (e: any) => e.bucket === 'fraud_reserve',
      );
      expect(reserveEntry).toBeDefined();
      expect(reserveEntry.amountMinor).toBe(30); // 10% of 300
      expect(reserveEntry.referenceId).toBe(clickId);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 5: Revenue split validation
  // ──────────────────────────────────────────────────────────────

  describe('Phase 5: Revenue split math', () => {
    it('default split is 60/30/10', () => {
      const split = svc.ledger.calculateSplit(1000, false);
      expect(split.userShare).toBe(600);
      expect(split.platformShare).toBe(300);
      expect(split.reserveShare).toBe(100);
      expect(split.userShare + split.platformShare + split.reserveShare).toBe(1000);
    });

    it('launch incentive split is 80/10/10', () => {
      const split = svc.ledger.calculateSplit(1000, true);
      expect(split.userShare).toBe(800);
      expect(split.platformShare).toBe(100);
      expect(split.reserveShare).toBe(100);
    });

    it('remainder goes to user share', () => {
      // 10 cents split: 60% = 6.0, floors to 6, remainder 1 goes to user
      const split = svc.ledger.calculateSplit(10, false);
      expect(split.userShare + split.platformShare + split.reserveShare).toBe(10);
      expect(split.userShare).toBeGreaterThanOrEqual(split.platformShare);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 6: Hold periods by trust level
  // ──────────────────────────────────────────────────────────────

  describe('Phase 6: Hold periods based on trust level', () => {
    it('new accounts get 30 days hold', () => {
      expect(svc.ledger.getHoldDays('new')).toBe(30);
    });

    it('low_trust accounts get 30 days hold', () => {
      expect(svc.ledger.getHoldDays('low_trust')).toBe(30);
    });

    it('normal trust gets 14 days hold', () => {
      expect(svc.ledger.getHoldDays('normal')).toBe(14);
    });

    it('high_trust gets 7 days hold', () => {
      expect(svc.ledger.getHoldDays('high_trust')).toBe(7);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 7: Maturation of earnings
  // ──────────────────────────────────────────────────────────────

  describe('Phase 7: Earnings mature from estimated to confirmed', () => {
    it('matures estimated entries past their availableAt date', async () => {
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 3 });

      await svc.ledger.matureEarnings();

      expect(mockPrisma.earningsLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'estimated',
            availableAt: expect.any(Object), // lte: now
          }),
          data: { status: 'confirmed' },
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 8: Fraud self-click detection
  // ──────────────────────────────────────────────────────────────

  describe('Phase 8: Fraud — self-click prevention', () => {
    it('blocks advertiser from clicking their own campaign', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'camp-self',
        advertiser: { userId: 'adv-user-1' },
      });
      // checkSelfClick → createFlag (CRITICAL self-clicking) → ledger.holdEarnings.
      // createFlag mock must return an id so `flag.id` doesn't crash before
      // holdEarnings fires.
      mockPrisma.fraudFlag.create.mockResolvedValue({ id: 'flag-self-click' });
      // holdEarnings calls prisma.earningsLedger.updateMany — without a
      // resolved value the await would throw on `undefined.count`.
      mockPrisma.earningsLedger.updateMany.mockResolvedValue({ count: 0 });

      const result = await svc.fraud.checkSelfClick('adv-user-1', 'camp-self');
      expect(result.allowed).toBe(false);
    });

    it('allows different user clicking campaign', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: 'camp-other',
        advertiser: { userId: 'adv-user-2' },
      });

      const result = await svc.fraud.checkSelfClick('dev-user-1', 'camp-other');
      expect(result.allowed).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 9: Full end-to-end orchestration
  // ──────────────────────────────────────────────────────────────

  describe('Phase 9: Complete E2E orchestration', () => {
    it('runs full money loop: campaign creation → approval → ad serving → qualified impression → ledger verification', async () => {
      installLedgerCapture();

      // ── IDs ──
      const advUserId = uid('advu');
      const devUserId = uid('devu');
      const advProfileId = uid('advp');
      const campaignId = uid('camp');
      const creativeId = uid('cr');
      const deviceId = uid('dev');
      const sessionId = uid('sess');
      const waitStateId = uid('ws');
      const impressionId = uid('imp');
      const impressionToken = 'e2e-full-token-99999';
      const adminUserId = uid('adm');

      // ── Step 1: Create advertiser profile ──
      mockPrisma.advertiser.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: advUserId,
        email: 'biz@e2e.com',
        name: 'E2E Corp',
        role: 'advertiser',
        status: 'active',
      });
      mockPrisma.advertiser.create.mockResolvedValue({
        id: advProfileId,
        userId: advUserId,
        companyName: 'E2E Corp',
        billingEmail: 'biz@e2e.com',
      });
      await svc.advertiser.createProfile(advUserId, {
        companyName: 'E2E Corp',
        billingEmail: 'biz@e2e.com',
      });

      // ── Step 2: Create campaign ──
      mockPrisma.blockedCategory.findFirst.mockResolvedValue(null);
      mockPrisma.campaign.create.mockResolvedValue({
        id: campaignId,
        advertiserId: advProfileId,
        name: 'E2E Campaign',
        category: 'developer_tools',
        bidType: 'cpm',
        bidAmountMinor: 5_00,
        budgetTotalMinor: 500_00,
        budgetSpentMinor: 0,
        currency: 'USD',
        status: 'draft',
      });
      await svc.advertiser.createCampaign(advProfileId, {
        name: 'E2E Campaign',
        category: 'developer_tools',
        bidType: 'cpm',
        bidAmountMinor: 5_00,
        budgetTotalMinor: 500_00,
      });

      // ── Step 3: Create creative ──
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: campaignId, status: 'draft' });
      mockPrisma.adCreative.create.mockResolvedValue({
        id: creativeId,
        campaignId,
        title: 'E2E Ad',
        sponsoredMessage: 'E2E test ad message',
        destinationUrl: 'https://e2e.example.com',
        displayDomain: 'e2e.example.com',
        status: 'draft',
      });
      await svc.campaign.createCreative(
        campaignId,
        {
          title: 'E2E Ad',
          sponsoredMessage: 'E2E test ad message',
          destinationUrl: 'https://e2e.example.com',
          displayDomain: 'e2e.example.com',
        },
        { role: 'admin' },
      );

      // ── Step 4: Admin approves creative ──
      mockPrisma.adCreative.findUnique.mockResolvedValue({
        id: creativeId,
        campaignId,
        status: 'draft',
      });
      mockPrisma.adCreative.update.mockResolvedValue({
        id: creativeId,
        campaignId,
        status: 'approved',
      });
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        status: 'draft',
        creatives: [{ id: creativeId, status: 'approved' }],
      });
      await svc.campaign.approveCreative(creativeId);

      // ── Step 5: Submit campaign ──
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        advertiserId: advProfileId,
        status: 'draft',
        creatives: [{ id: creativeId, status: 'approved' }],
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campaignId,
        status: 'submitted',
        submittedAt: new Date(),
      });
      await svc.advertiser.submitCampaign(campaignId, advProfileId);

      // ── Step 6: Admin approves campaign → active ──
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        status: 'submitted',
        budgetSpentMinor: 0,
        budgetTotalMinor: 50000,
        creatives: [{ id: creativeId, status: 'approved' }],
      });
      mockPrisma.campaignApproval.create.mockResolvedValue({
        id: uid('ca'),
        campaignId,
        reviewerId: adminUserId,
        decision: 'approved',
      });
      mockPrisma.$transaction.mockImplementationOnce(async (arg: any) => {
        if (typeof arg === 'function') return arg(mockPrisma);
        return [
          { id: campaignId, status: 'active', approvedAt: new Date(), activatedAt: new Date() },
          { id: uid('ca'), campaignId, reviewerId: adminUserId, decision: 'approved' },
        ];
      });
      await svc.admin.approveCampaign(campaignId, adminUserId);

      // ── Step 7: Register device ──
      mockPrisma.device.findUnique.mockResolvedValue(null);
      mockPrisma.device.findFirst.mockResolvedValue(null);
      mockPrisma.device.create.mockResolvedValue({
        id: deviceId,
        userId: devUserId,
        fingerprintHash: 'fp-e2e',
        toolType: 'claude_code',
        extensionVersion: '1.0.0',
        platform: 'linux',
      });
      await svc.extension.registerDevice(devUserId, {
        toolType: 'claude_code',
        fingerprintHash: 'fp-e2e',
        extensionVersion: '1.0.0',
        platform: 'linux',
      });

      // ── Step 8: Wait-state-start ──
      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId,
        userId: devUserId,
        eventSecret: DEVICE_EVENT_SECRET,
        fingerprintHash: 'fp-e2e',
        toolType: 'claude_code',
      });
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue(null);
      mockPrisma.waitStateEvent.create.mockResolvedValue({
        id: uid('wse'),
        userId: devUserId,
        deviceId,
        sessionId,
        eventType: 'wait_state_start',
        waitStateId,
        toolType: 'claude_code',
        idempotencyKey: 'idem-e2e-ws',
        createdAt: new Date(),
      });
      const wsPayload = {
        deviceId,
        sessionId,
        toolType: 'claude_code',
        waitStateId,
        idempotencyKey: 'idem-e2e-ws',
      };
      await svc.extension.recordWaitStateStart(devUserId, {
        ...wsPayload,
        signature: hmacSign(wsPayload),
      });

      // ── Step 9: Request ad ──
      mockPrisma.advertiserLedger.groupBy.mockResolvedValue([
        {
          advertiserId: advProfileId,
          currency: 'USD',
          entryType: 'credit',
          _sum: { amountMinor: 10000_00 },
        },
      ]);
      mockPrisma.userSettings.findUnique.mockResolvedValue({ userId: devUserId, adsEnabled: true });
      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId,
        userId: devUserId,
        eventSecret: DEVICE_EVENT_SECRET,
        user: { status: 'active' },
      });
      mockPrisma.waitStateEvent.findFirst.mockImplementation(({ where }: any) => {
        if (where.eventType === 'wait_state_start') {
          return Promise.resolve({
            userId: devUserId,
            deviceId,
            sessionId,
            waitStateId,
            eventType: 'wait_state_start',
            createdAt: new Date(Date.now() - 1000),
          });
        }
        return Promise.resolve(null);
      });
      mockPrisma.adImpression.findFirst.mockResolvedValue(null);
      mockPrisma.adImpression.findMany.mockResolvedValue([]);
      // explicit cap-count: vi.clearAllMocks() does NOT reset prior
      // mockResolvedValue overrides set elsewhere in the file, and Phase 3
      // sets adImpression.count(61). Without this, the new transactional
      // frequency-cap (which uses count under an advisory lock) would see
      // the stale 61 and short-circuit requestAd as `user_hourly_cap_reached`.
      mockPrisma.adImpression.count.mockResolvedValue(0);
      mockPrisma.campaign.findMany.mockResolvedValue([
        {
          id: campaignId,
          advertiserId: advProfileId,
          name: 'E2E Campaign',
          status: 'active',
          category: 'developer_tools',
          bidType: 'cpm',
          bidAmountMinor: 5_00,
          budgetTotalMinor: 500_00,
          budgetSpentMinor: 0,
          currency: 'USD',
          frequencyCapPerHour: 2,
          frequencyCapPerDay: 6,
          creatives: [
            {
              id: creativeId,
              campaignId,
              title: 'E2E Ad',
              sponsoredMessage: 'E2E test ad message',
              displayDomain: 'e2e.example.com',
              destinationUrl: 'https://e2e.example.com',
              status: 'approved',
            },
          ],
          countryTargeting: [],
        },
      ]);
      mockPrisma.adImpression.create.mockResolvedValue({
        id: impressionId,
        campaignId,
        creativeId,
        userId: devUserId,
        deviceId,
        sessionId,
        impressionTokenHash: require('crypto')
          .createHash('sha256')
          .update(impressionToken)
          .digest('hex'),
        isBillable: false,
        createdAt: new Date(),
      });
      const adPayload = {
        deviceId,
        sessionId,
        waitStateId,
        toolType: 'claude_code',
        idempotencyKey: 'idem-e2e-ad',
      };
      const adResult = await svc.extension.requestAd(devUserId, {
        ...adPayload,
        signature: hmacSign(adPayload),
      });
      expect(adResult.ad).toBeDefined();
      expect(adResult.ad.campaignId).toBe(campaignId);

      // ── Step 10: Record rendered ──
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impressionId,
        userId: devUserId,
        deviceId,
        impressionTokenHash: require('crypto')
          .createHash('sha256')
          .update(impressionToken)
          .digest('hex'),
        renderedAt: null,
      });
      mockPrisma.adImpression.update.mockResolvedValue({
        id: impressionId,
        renderedAt: new Date(),
      });
      const rendPayload = {
        impressionToken,
        renderedAt: new Date().toISOString(),
        idempotencyKey: 'idem-e2e-rend',
      };
      await svc.extension.recordRendered(devUserId, {
        ...rendPayload,
        signature: hmacSign(rendPayload),
      });

      // ── Step 11: Qualified impression → MONEY MOVES ──
      mockPrisma.adImpression.count.mockResolvedValue(5); // under fraud limit
      mockPrisma.trustScore.findUnique.mockResolvedValue({
        userId: devUserId,
        score: 55,
        level: 'normal',
      });
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impressionId,
        campaignId,
        creativeId,
        userId: devUserId,
        deviceId,
        sessionId,
        impressionTokenHash: require('crypto')
          .createHash('sha256')
          .update(impressionToken)
          .digest('hex'),
        renderedAt: new Date(Date.now() - 6000),
        qualifiedAt: null,
        isBillable: false,
        campaign: {
          id: campaignId,
          bidAmountMinor: 5_00,
          currency: 'USD',
          advertiserId: advProfileId,
          bidType: 'cpm',
        },
        user: { status: 'active' },
      });
      mockPrisma.adImpression.update.mockResolvedValue({
        id: impressionId,
        isBillable: true,
        qualifiedAt: new Date(),
        visibleDurationMs: 8000,
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campaignId,
        budgetSpentMinor: 5_00,
      });

      // Capture the $transaction call for ledger verification
      mockPrisma.$transaction.mockImplementationOnce(async (arg: any) => {
        if (Array.isArray(arg)) {
          const results = [];
          for (const fn of arg) {
            results.push(await (typeof fn === 'function' ? fn() : fn));
          }
          return results;
        }
        if (typeof arg === 'function') return arg(mockPrisma);
        return arg;
      });

      const qualPayload = {
        impressionToken,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 8000,
        idempotencyKey: 'idem-e2e-qual',
      };
      const qualResult = await svc.extension.recordQualifiedImpression(devUserId, {
        ...qualPayload,
        signature: hmacSign(qualPayload),
      });
      expect(qualResult.qualified).toBe(true);

      // ── FINAL ASSERTIONS: All ledger entries correct ──
      // Advertiser debit: full bid amount
      const advDebits = recordedLedgerEntries.advertiser.filter(
        (e: any) => e.entryType === 'debit',
      );
      expect(advDebits.length).toBeGreaterThanOrEqual(1);
      const totalAdvCharged = advDebits.reduce((sum: number, e: any) => sum + e.amountMinor, 0);
      expect(totalAdvCharged).toBe(5_00); // $5.00 charged to advertiser

      // Developer earnings: 60% of bid (300 cents)
      const devCredits = recordedLedgerEntries.earnings.filter(
        (e: any) => e.entryType === 'credit',
      );
      expect(devCredits.length).toBeGreaterThanOrEqual(1);
      const devEarning = devCredits.find((e: any) => e.impressionId === impressionId);
      expect(devEarning).toBeDefined();
      expect(devEarning.amountMinor).toBe(300); // 60% of 500
      expect(devEarning.status).toBe('estimated');
      expect(devEarning.availableAt).toBeDefined();

      // Platform fee: 30% of bid (150 cents)
      const platFee = recordedLedgerEntries.platform.find((e: any) => e.bucket === 'platform_fee');
      expect(platFee).toBeDefined();
      expect(platFee.amountMinor).toBe(150); // 30% of 500
      expect(platFee.status).toBe('confirmed');

      // Fraud reserve: 10% of bid (50 cents)
      const reserve = recordedLedgerEntries.platform.find((e: any) => e.bucket === 'fraud_reserve');
      expect(reserve).toBeDefined();
      expect(reserve.amountMinor).toBe(50); // 10% of 500
      expect(reserve.status).toBe('confirmed');

      // Sum check: advertiser debit (500) = dev (300) + platform (150) + reserve (50)
      expect(devEarning.amountMinor + platFee.amountMinor + reserve.amountMinor).toBe(5_00);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Phase 10: Failure modes
  // ──────────────────────────────────────────────────────────────

  describe('Phase 10: Failure modes and edge cases', () => {
    it('rejects wait-state-start with wrong HMAC signature', async () => {
      // Device must belong to the user so we get past the device check
      const userId = uid('u');
      const deviceId = uid('dev');
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue(null); // not idempotent
      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId,
        userId,
        eventSecret: DEVICE_EVENT_SECRET,
        fingerprintHash: 'fp-test',
        toolType: 'claude_code',
      });

      const payload = {
        deviceId,
        sessionId: uid('sess'),
        toolType: 'claude_code',
        waitStateId: uid('ws'),
        idempotencyKey: 'idem-bad-sig',
      };
      // Sign with wrong secret
      const wrongSig = signPayload(payload, 'wrong-secret');

      await expect(
        svc.extension.recordWaitStateStart(userId, { ...payload, signature: wrongSig }),
      ).rejects.toThrow(/Invalid request signature/);
    });

    it('rejects legacy device rows without per-device secrets even with global HMAC', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue(null);
      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId,
        userId,
        eventSecret: null,
        fingerprintHash: 'legacy-fp',
        toolType: 'claude_code',
      });

      const payload = {
        deviceId,
        sessionId: uid('sess'),
        toolType: 'claude_code',
        waitStateId: uid('ws'),
        idempotencyKey: 'idem-legacy-global-sig',
      };

      await expect(
        svc.extension.recordWaitStateStart(userId, {
          ...payload,
          signature: hmacSign(payload, HMAC_SECRET),
        }),
      ).rejects.toThrow(/Invalid request signature/);
    });

    it('issues a one-time per-device secret when a same-user legacy device re-registers', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const legacyDevice = {
        id: deviceId,
        userId,
        eventSecret: null,
        fingerprintHash: 'legacy-fp',
        toolType: 'claude_code',
        extensionVersion: '0.9.0',
        platform: 'linux',
      };

      mockPrisma.device.findUnique.mockResolvedValue(legacyDevice);
      mockPrisma.device.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ ...legacyDevice, ...data }),
      );

      const result = await svc.extension.registerDevice(userId, {
        toolType: 'claude_code',
        fingerprintHash: 'legacy-fp',
        extensionVersion: '1.0.0',
        platform: 'linux',
      });

      expect(result.eventSecret).toEqual(expect.any(String));
      expect(result.eventSecret).not.toBe(HMAC_SECRET);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: deviceId },
        data: expect.objectContaining({
          eventSecret: expect.any(String),
          extensionVersion: '1.0.0',
          platform: 'linux',
        }),
      });
    });

    it('rotates an existing device secret when the caller proves possession of the old secret', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const existingSecret = 'existing-device-event-secret';
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: existingSecret,
        fingerprintHash: 'recover-fp',
        toolType: 'claude_code',
        extensionVersion: '1.0.0',
        platform: 'linux',
      };

      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.device.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ ...existingDevice, ...data }),
      );

      const result = await svc.extension.registerDevice(userId, {
        toolType: 'claude_code',
        fingerprintHash: 'recover-fp',
        extensionVersion: '1.1.0',
        platform: 'linux',
        existingEventSecret: existingSecret,
      });

      expect(result.eventSecret).toEqual(expect.any(String));
      expect(result.eventSecret).not.toBe(existingSecret);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('recovers a lost device secret when the same user re-authenticates with their password', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const oldSecret = 'old-device-event-secret';
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: oldSecret,
        fingerprintHash: 'password-recover-fp',
        toolType: 'claude_code',
        extensionVersion: '1.0.0',
        platform: 'linux',
      };

      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: await bcrypt.hash('correct-password', 12),
      });
      mockPrisma.device.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ ...existingDevice, ...data }),
      );

      const result = await svc.extension.registerDevice(userId, {
        toolType: 'claude_code',
        fingerprintHash: 'password-recover-fp',
        extensionVersion: '1.1.0',
        platform: 'linux',
        recoveryPassword: 'correct-password',
      });

      expect(result.eventSecret).toEqual(expect.any(String));
      expect(result.eventSecret).not.toBe(oldSecret);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: deviceId },
        data: expect.objectContaining({
          eventSecret: expect.any(String),
          extensionVersion: '1.1.0',
        }),
      });
    });

    it('rejects lost-secret recovery when the account password is wrong', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: 'old-device-event-secret',
        fingerprintHash: 'bad-password-recover-fp',
        toolType: 'claude_code',
      };

      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: await bcrypt.hash('correct-password', 12),
      });

      await expect(
        svc.extension.registerDevice(userId, {
          toolType: 'claude_code',
          fingerprintHash: 'bad-password-recover-fp',
          recoveryPassword: 'wrong-password',
        }),
      ).rejects.toThrow(/Password re-authentication failed/);
      expect(mockPrisma.device.update).not.toHaveBeenCalled();
    });

    it('recovers a lost device secret for a Google-linked user with matching Google re-auth', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const oldSecret = 'old-google-device-event-secret';
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: oldSecret,
        fingerprintHash: 'google-recover-fp',
        toolType: 'claude_code',
      };

      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: null,
        googleId: 'google-sub-123',
        email: 'social@example.com',
      });
      mockGoogleVerifier.verify.mockResolvedValue({
        sub: 'google-sub-123',
        email: 'social@example.com',
        email_verified: true,
        aud: 'test-client',
        iss: 'accounts.google.com',
      });
      mockPrisma.device.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ ...existingDevice, ...data }),
      );

      const result = await svc.extension.registerDevice(userId, {
        toolType: 'claude_code',
        fingerprintHash: 'google-recover-fp',
        recoveryGoogleIdToken: 'valid-google-token',
      });

      expect(result.eventSecret).toEqual(expect.any(String));
      expect(result.eventSecret).not.toBe(oldSecret);
      expect(mockGoogleVerifier.verify).toHaveBeenCalledWith('valid-google-token');
    });

    it('rejects Google-linked device-secret recovery when Google re-auth does not match the account', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: 'old-google-device-event-secret',
        fingerprintHash: 'google-mismatch-fp',
        toolType: 'claude_code',
      };

      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: null,
        googleId: 'google-sub-123',
        email: 'social@example.com',
      });
      mockGoogleVerifier.verify.mockResolvedValue({
        sub: 'different-google-sub',
        email: 'social@example.com',
        email_verified: true,
        aud: 'test-client',
        iss: 'accounts.google.com',
      });

      await expect(
        svc.extension.registerDevice(userId, {
          toolType: 'claude_code',
          fingerprintHash: 'google-mismatch-fp',
          recoveryGoogleIdToken: 'mismatched-google-token',
        }),
      ).rejects.toThrow(/Google re-authentication failed/);
      expect(mockPrisma.device.update).not.toHaveBeenCalled();
    });

    it('issues and consumes a one-time support recovery token for a passwordless non-Google account', async () => {
      const userId = uid('u');
      const reviewerId = uid('support');
      const deviceId = uid('dev');
      const oldSecret = 'old-support-device-event-secret';
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: oldSecret,
        fingerprintHash: 'support-recover-fp',
        toolType: 'claude_code',
      };

      mockPrisma.device.findUnique
        .mockResolvedValueOnce({
          ...existingDevice,
          user: {
            id: userId,
            email: 'future-provider@example.com',
            role: 'developer',
            status: 'active',
          },
        })
        .mockResolvedValueOnce(existingDevice);
      mockPrisma.deviceRecoveryToken.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      mockPrisma.deviceRecoveryToken.create.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ id: 'support-token-id', ...data }),
      );
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: null,
        googleId: null,
        email: 'future-provider@example.com',
      });
      mockPrisma.device.update.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ ...existingDevice, ...data }),
      );

      const issued = await svc.admin.issueDeviceRecoveryToken({
        deviceId,
        userId,
        reviewerId,
        reviewerRole: 'support',
        reason: 'Verified identity through support workflow',
        expiresInMinutes: 15,
      });
      const tokenHash = crypto
        .createHash('sha256')
        .update(issued.recoverySupportToken, 'utf8')
        .digest('hex');
      mockPrisma.deviceRecoveryToken.findUnique.mockResolvedValue({
        id: issued.tokenId,
        userId,
        deviceId,
        expiresAt: issued.expiresAt,
        usedAt: null,
        revokedAt: null,
      });

      const result = await svc.extension.registerDevice(userId, {
        toolType: 'claude_code',
        fingerprintHash: 'support-recover-fp',
        recoverySupportToken: issued.recoverySupportToken,
      });

      expect(issued.recoverySupportToken).toEqual(expect.any(String));
      expect(issued.recoverySupportToken).not.toContain(tokenHash);
      expect(mockPrisma.deviceRecoveryToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          deviceId,
          createdByUserId: reviewerId,
          tokenHash,
          reason: 'Verified identity through support workflow',
        }),
      });
      expect(mockPrisma.deviceRecoveryToken.updateMany).toHaveBeenLastCalledWith({
        where: expect.objectContaining({
          id: issued.tokenId,
          userId,
          deviceId,
          tokenHash,
          usedAt: null,
          revokedAt: null,
        }),
        data: expect.objectContaining({ usedAt: expect.any(Date) }),
      });
      expect(result.eventSecret).toEqual(expect.any(String));
      expect(result.eventSecret).not.toBe(oldSecret);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: deviceId },
        data: expect.objectContaining({
          eventSecret: expect.any(String),
        }),
      });
    });

    it('rejects reused support recovery tokens before rotating the device secret', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const recoverySupportToken = 'support-token-that-has-already-been-used-123';
      const existingDevice = {
        id: deviceId,
        userId,
        eventSecret: 'old-support-device-event-secret',
        fingerprintHash: 'used-support-token-fp',
        toolType: 'claude_code',
      };

      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: null,
        googleId: null,
        email: 'future-provider@example.com',
      });
      mockPrisma.deviceRecoveryToken.findUnique.mockResolvedValue({
        id: 'used-support-token-id',
        userId,
        deviceId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        usedAt: new Date(),
        revokedAt: null,
      });

      await expect(
        svc.extension.registerDevice(userId, {
          toolType: 'claude_code',
          fingerprintHash: 'used-support-token-fp',
          recoverySupportToken,
        }),
      ).rejects.toThrow(/Support recovery token is invalid or expired/);
      expect(mockPrisma.deviceRecoveryToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.device.update).not.toHaveBeenCalled();
    });

    it('lists users with unrecovered paid-fraud debt and attaches their latest collections case', async () => {
      const userId = uid('u');
      mockPrisma.earningsLedger.groupBy
        .mockResolvedValueOnce([
          { userId, currency: 'USD', _sum: { amountMinor: 1500 }, _count: { _all: 2 } },
          {
            userId: 'settled-user',
            currency: 'USD',
            _sum: { amountMinor: 300 },
            _count: { _all: 1 },
          },
        ])
        .mockResolvedValueOnce([
          { userId, currency: 'USD', _sum: { amountMinor: 500 } },
          { userId: 'settled-user', currency: 'USD', _sum: { amountMinor: 300 } },
        ]);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: userId,
          email: 'debt@example.com',
          name: 'Debt User',
          status: 'active',
          trustLevel: 'restricted',
        },
      ]);
      mockPrisma.recoveryDebtCase.findMany.mockResolvedValue([
        {
          id: 'case-eur-newer',
          userId,
          status: 'in_collections',
          amountMinor: 9999,
          currency: 'EUR',
          updatedAt: new Date('2026-07-08T00:00:00.000Z'),
        },
        {
          id: 'case-latest',
          userId,
          status: 'in_collections',
          amountMinor: 1000,
          currency: 'USD',
          updatedAt: new Date('2026-07-07T00:00:00.000Z'),
        },
      ]);

      const result = await svc.admin.getRecoveryDebtCases({ page: 1, limit: 20 });

      expect(mockPrisma.recoveryDebtCase.findMany).toHaveBeenCalledWith({
        where: { userId: { in: [userId] }, currency: { in: ['USD'] } },
        orderBy: { updatedAt: 'desc' },
      });
      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        userId,
        currency: 'USD',
        confirmedDebitMinor: 1500,
        confirmedCreditMinor: 500,
        outstandingDebtMinor: 1000,
        recoveryDebitEntryCount: 2,
        user: { email: 'debt@example.com' },
        latestCase: { id: 'case-latest', status: 'in_collections' },
      });
    });

    it('opens an active recovery debt case from the current outstanding debt snapshot', async () => {
      const userId = uid('u');
      const reviewerId = uid('admin');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: userId,
        email: 'debt@example.com',
        role: 'developer',
        status: 'restricted',
      });
      mockPrisma.earningsLedger.aggregate
        .mockResolvedValueOnce({ _sum: { amountMinor: 2500 } })
        .mockResolvedValueOnce({ _sum: { amountMinor: 400 } });
      mockPrisma.recoveryDebtCase.findFirst.mockResolvedValue(null);
      mockPrisma.recoveryDebtCase.create.mockImplementationOnce(({ data }: any) =>
        Promise.resolve({ id: 'case-open', ...data }),
      );

      const result = await svc.admin.openRecoveryDebtCase({
        userId,
        reviewerId,
        reviewerRole: 'admin',
        status: 'in_collections',
        currency: 'eur',
        externalReference: 'COLL-123',
        note: 'No future earnings after paid-fraud reversal',
      });

      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenNthCalledWith(1, {
        where: { userId, currency: 'EUR', status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      });
      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenNthCalledWith(2, {
        where: { userId, currency: 'EUR', status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      });
      expect(result.debt.outstandingDebtMinor).toBe(2100);
      expect(mockPrisma.recoveryDebtCase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          status: 'in_collections',
          amountMinor: 2100,
          currency: 'EUR',
          externalReference: 'COLL-123',
          note: 'No future earnings after paid-fraud reversal',
          openedByUserId: reviewerId,
        }),
      });
      expect(result.case.id).toBe('case-open');
    });

    it('resolves only active recovery debt cases and records the current debt snapshot', async () => {
      const userId = uid('u');
      const reviewerId = uid('admin');
      const existingCase = {
        id: 'case-active',
        userId,
        status: 'in_collections',
        amountMinor: 2100,
        currency: 'EUR',
      };
      const resolvedCase = {
        ...existingCase,
        status: 'written_off',
        resolvedByUserId: reviewerId,
        resolvedAt: new Date('2026-07-07T00:00:00.000Z'),
      };
      mockPrisma.recoveryDebtCase.findUnique
        .mockResolvedValueOnce(existingCase)
        .mockResolvedValueOnce(resolvedCase);
      mockPrisma.recoveryDebtCase.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.earningsLedger.aggregate
        .mockResolvedValueOnce({ _sum: { amountMinor: 2500 } })
        .mockResolvedValueOnce({ _sum: { amountMinor: 400 } });

      const result = await svc.admin.resolveRecoveryDebtCase({
        caseId: existingCase.id,
        reviewerId,
        reviewerRole: 'admin',
        status: 'written_off',
        externalReference: 'COLL-123',
        note: 'Legal write-off approved',
      });

      expect(mockPrisma.recoveryDebtCase.updateMany).toHaveBeenCalledWith({
        where: {
          id: existingCase.id,
          status: { in: ['open', 'in_collections'] },
        },
        data: expect.objectContaining({
          status: 'written_off',
          externalReference: 'COLL-123',
          note: 'Legal write-off approved',
          resolvedByUserId: reviewerId,
          resolvedAt: expect.any(Date),
        }),
      });
      expect(result.case?.status).toBe('written_off');
      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenNthCalledWith(1, {
        where: { userId, currency: 'EUR', status: 'confirmed', entryType: 'debit' },
        _sum: { amountMinor: true },
      });
      expect(mockPrisma.earningsLedger.aggregate).toHaveBeenNthCalledWith(2, {
        where: { userId, currency: 'EUR', status: 'confirmed', entryType: 'credit' },
        _sum: { amountMinor: true },
      });
      expect(result.debt.outstandingDebtMinor).toBe(2100);
    });

    it('rejects wait-state-start for device not owned by user', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: uid('dev'),
        userId: 'other-user',
        eventSecret: DEVICE_EVENT_SECRET,
      });

      const payload = {
        deviceId: uid('dev'),
        sessionId: uid('sess'),
        toolType: 'claude_code',
        waitStateId: uid('ws'),
        idempotencyKey: 'idem-wrong-dev',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      await expect(svc.extension.recordWaitStateStart(uid('u'), signed)).rejects.toThrow(
        /Device does not belong/,
      );
    });

    it('rejects campaign submit without approved creative', async () => {
      const advId = uid('advp');
      const campId = uid('camp');
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campId,
        advertiserId: advId,
        status: 'draft',
        creatives: [], // no creatives
      });

      await expect(svc.advertiser.submitCampaign(campId, advId)).rejects.toThrow(
        /at least one creative/,
      );
    });

    it('allows campaign submit when creatives exist and are not approved', async () => {
      const advId = uid('advp');
      const campId = uid('camp');
      mockPrisma.campaign.findUnique
        .mockResolvedValueOnce({
          id: campId,
          advertiserId: advId,
          status: 'draft',
          creatives: [{ id: uid('cr'), status: 'draft' }],
        })
        .mockResolvedValueOnce({
          id: campId,
          advertiserId: advId,
          status: 'submitted',
        });
      mockPrisma.campaign.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.adCreative.updateMany.mockResolvedValue({ count: 1 });

      const res = await svc.advertiser.submitCampaign(campId, advId);
      expect(res.status).toBe('submitted');
      expect(mockPrisma.campaign.updateMany).toHaveBeenCalledWith({
        where: { id: campId, advertiserId: advId, status: 'draft' },
        data: { status: 'submitted', submittedAt: expect.any(Date) },
      });
      expect(mockPrisma.adCreative.updateMany).toHaveBeenCalledWith({
        where: { campaignId: campId, status: 'draft' },
        data: { status: 'pending_review' },
      });
    });

    it('does not submit a campaign if a concurrent archive wins the status race', async () => {
      const advId = uid('advp');
      const campId = uid('camp');
      mockPrisma.campaign.findUnique
        .mockResolvedValueOnce({
          id: campId,
          advertiserId: advId,
          status: 'draft',
          creatives: [{ id: uid('cr'), status: 'draft' }],
        })
        .mockResolvedValueOnce({
          id: campId,
          advertiserId: advId,
          status: 'archived',
        });
      mockPrisma.campaign.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(svc.advertiser.submitCampaign(campId, advId)).rejects.toThrow(
        /current status is archived/,
      );

      expect(mockPrisma.adCreative.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.campaign.update).not.toHaveBeenCalled();
    });

    it('handles idempotent wait-state-start (returns existing record)', async () => {
      const userId = uid('u');
      const deviceId = uid('dev');
      const sessionId = uid('sess');
      const waitStateId = uid('ws');

      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId,
        userId,
        eventSecret: DEVICE_EVENT_SECRET,
      });
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue({
        id: uid('wse'),
        userId,
        deviceId,
        sessionId,
        waitStateId,
        eventType: 'wait_state_start',
        idempotencyKey: 'idem-dup',
      });

      const payload = {
        deviceId,
        sessionId,
        toolType: 'claude_code',
        waitStateId,
        idempotencyKey: 'idem-dup',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordWaitStateStart(userId, signed);
      expect(result.eventType).toBe('wait_state_start');
      expect(result.idempotencyKey).toBe('idem-dup');
      // Should not call create
      expect(mockPrisma.waitStateEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('Phase 11: Extra MVP Hardening & Security Checks', () => {
    it('CPC Campaign qualification does not bill, click does bill and splits correctly', async () => {
      // 1. Qualified impression (CPC)
      const impId = uid('imp-cpc');
      const token = 'token-cpc-123';
      const hash = require('crypto').createHash('sha256').update(token).digest('hex');

      const cpcDevUserId = 'cpc-dev-user';
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'cpc-device',
        userId: cpcDevUserId,
        eventSecret: DEVICE_EVENT_SECRET,
      });
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impId,
        campaignId: uid('c'),
        creativeId: uid('cr'),
        userId: cpcDevUserId,
        deviceId: uid('dev'),
        sessionId: uid('sess'),
        impressionTokenHash: hash,
        renderedAt: new Date(Date.now() - 6000),
        campaign: {
          id: uid('c'),
          bidAmountMinor: 5_00,
          currency: 'USD',
          advertiserId: uid('adv'),
          bidType: 'cpc',
        },
        user: { status: 'active' },
      });
      mockPrisma.adCreative.findUnique.mockResolvedValue({
        destinationUrl: 'https://cpc.example.com/offer',
      });

      // Fraud checks allowed
      mockPrisma.adClick.count.mockResolvedValue(0);
      mockPrisma.adImpression.count.mockResolvedValue(0);

      // Setup ledger capture
      installLedgerCapture();

      mockPrisma.adImpression.update.mockResolvedValue({ id: impId });

      const signedImp = {
        impressionToken: token,
        qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 6000,
        idempotencyKey: 'idem-cpc-imp',
      };
      const signedImpPayload = { ...signedImp, signature: hmacSign(signedImp) };

      const impResult = await svc.extension.recordQualifiedImpression(
        cpcDevUserId,
        signedImpPayload,
      );
      expect(impResult.qualified).toBe(true);

      // Verify NO ledger entries were created during qualification
      expect(recordedLedgerEntries.advertiser.length).toBe(0);
      expect(recordedLedgerEntries.earnings.length).toBe(0);
      expect(recordedLedgerEntries.platform.length).toBe(0);

      // 2. Click (CPC)
      // Mock trust level
      mockPrisma.trustScore.findUnique.mockResolvedValue({
        userId: uid('u'),
        score: 60,
        level: 'normal',
      });
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: uid('c'),
        advertiser: { userId: 'diff' },
      });
      mockPrisma.adClick.create.mockResolvedValue({ id: uid('clk') });

      // Before click, mock the impression lookup as already qualified
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impId,
        campaignId: uid('c'),
        creativeId: uid('cr'),
        userId: cpcDevUserId,
        deviceId: uid('dev'),
        sessionId: uid('sess'),
        impressionTokenHash: hash,
        qualifiedAt: new Date(), // Now qualified!
        campaign: {
          id: uid('c'),
          bidAmountMinor: 5_00,
          currency: 'USD',
          advertiserId: uid('adv'),
          bidType: 'cpc',
        },
        user: { status: 'active' },
      });

      const signedClick = {
        impressionToken: token,
        clickedAt: new Date().toISOString(),
        idempotencyKey: 'idem-cpc-clk',
      };
      const signedClickPayload = { ...signedClick, signature: hmacSign(signedClick) };

      const clickResult = await svc.extension.recordClick(cpcDevUserId, signedClickPayload);
      expect(clickResult.clicked).toBe(true);
      const clickId = clickResult.clickId;

      // Verify CPC click charged advertiser & credited user & platform & reserve
      const advDebit = recordedLedgerEntries.advertiser.find((e: any) => e.entryType === 'debit');
      expect(advDebit).toBeDefined();
      expect(advDebit.amountMinor).toBe(5_00);

      const devCredit = recordedLedgerEntries.earnings.find((e: any) => e.entryType === 'credit');
      expect(devCredit).toBeDefined();
      expect(devCredit.amountMinor).toBe(300); // 60% of 5_00
      expect(devCredit.clickId).toBe(clickId);

      const platformEntry = recordedLedgerEntries.platform.find(
        (e: any) => e.bucket === 'platform_fee',
      );
      expect(platformEntry).toBeDefined();
      expect(platformEntry.amountMinor).toBe(150); // 30% of 5_00
      expect(platformEntry.referenceId).toBe(clickId);

      const reserveEntry = recordedLedgerEntries.platform.find(
        (e: any) => e.bucket === 'fraud_reserve',
      );
      expect(reserveEntry).toBeDefined();
      expect(reserveEntry.amountMinor).toBe(50); // 10% of 5_00
      expect(reserveEntry.referenceId).toBe(clickId);
    });

    it('does not bill CPC clicks for restricted developer accounts', async () => {
      const impId = uid('imp-cpc-restricted');
      const token = 'token-cpc-restricted';
      const hash = require('crypto').createHash('sha256').update(token).digest('hex');
      const cpcDevUserId = 'cpc-dev-restricted';
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'cpc-device-restricted',
        userId: cpcDevUserId,
        eventSecret: DEVICE_EVENT_SECRET,
      });
      mockPrisma.adClick.findUnique.mockResolvedValue(null);
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impId,
        campaignId: uid('c'),
        creativeId: uid('cr'),
        userId: cpcDevUserId,
        deviceId: 'cpc-device-restricted',
        sessionId: uid('sess'),
        impressionTokenHash: hash,
        qualifiedAt: new Date(),
        campaign: {
          id: uid('c'),
          bidAmountMinor: 5_00,
          currency: 'USD',
          advertiserId: uid('adv'),
          bidType: 'cpc',
        },
        user: { status: 'restricted' },
      });

      const clickPayload = {
        impressionToken: token,
        clickedAt: new Date().toISOString(),
        idempotencyKey: 'idem-cpc-restricted',
      };
      const signedClickPayload = { ...clickPayload, signature: hmacSign(clickPayload) };

      const clickResult = await svc.extension.recordClick(cpcDevUserId, signedClickPayload);
      expect(clickResult).toEqual({ clicked: false, reason: 'account_not_active' });
      expect(mockPrisma.adClick.create).not.toHaveBeenCalled();
      expect(recordedLedgerEntries.advertiser).toHaveLength(0);
      expect(recordedLedgerEntries.earnings).toHaveLength(0);
      expect(recordedLedgerEntries.platform).toHaveLength(0);
    });

    it('ad-request idempotency with same idempotencyKey or waitStateId returns cached ad with token', async () => {
      // Setup device check
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'dev-1',
        userId: 'usr-1',
        eventSecret: DEVICE_EVENT_SECRET,
        user: { status: 'active' },
      });
      mockPrisma.userSettings.findUnique.mockResolvedValue({ adsEnabled: true });
      mockPrisma.waitStateEvent.findFirst.mockImplementation(({ where }: any) => {
        if (where.eventType === 'wait_state_start') {
          return Promise.resolve({
            userId: 'usr-1',
            deviceId: 'dev-1',
            sessionId: 'sess-1',
            waitStateId: 'wait-1',
            eventType: 'wait_state_start',
            createdAt: new Date(Date.now() - 1000),
          });
        }
        return Promise.resolve(null);
      });
      mockPrisma.adImpression.findFirst.mockResolvedValue(null);

      mockPrisma.campaign.findMany.mockResolvedValue([
        {
          id: 'camp-1',
          advertiserId: 'adv-1',
          name: 'Idempotency Campaign',
          category: 'developer_tools',
          status: 'active',
          bidType: 'cpm',
          bidAmountMinor: 100,
          budgetTotalMinor: 1_000_00,
          budgetSpentMinor: 0,
          currency: 'USD',
          frequencyCapPerHour: 2,
          frequencyCapPerDay: 6,
          creatives: [
            {
              id: 'cr-1',
              title: 'Ad Title',
              sponsoredMessage: 'Ad msg',
              displayDomain: 'domain.com',
              destinationUrl: 'https://domain.com/offer',
              status: 'approved',
            },
          ],
          countryTargeting: [],
        },
      ]);

      const reqPayload = {
        deviceId: 'dev-1',
        sessionId: 'sess-1',
        waitStateId: 'wait-1',
        toolType: 'vscode',
        idempotencyKey: 'idem-ad-req-1',
      };
      const signed = { ...reqPayload, signature: hmacSign(reqPayload) };

      // First request serves ad and caches it
      const res1 = await svc.extension.requestAd('usr-1', signed);
      expect(res1.ad).toBeDefined();
      expect(res1.ad.impressionToken).toBeDefined();
      expect(res1.ad.title).toBe('Ad Title');

      // Second request with same idempotencyKey returns cached ad
      const res2 = await svc.extension.requestAd('usr-1', signed);
      expect(res2.ad).toBeDefined();
      expect(res2.ad.impressionToken).toBe(res1.ad.impressionToken); // Match same token!
      expect(res2.ad.title).toBe('Ad Title');

      // Second request with same waitStateId but diff idempotencyKey returns cached ad
      const reqPayloadDiffIdem = { ...reqPayload, idempotencyKey: 'idem-ad-req-2' };
      const signedDiffIdem = { ...reqPayloadDiffIdem, signature: hmacSign(reqPayloadDiffIdem) };
      const res3 = await svc.extension.requestAd('usr-1', signedDiffIdem);
      expect(res3.ad).toBeDefined();
      expect(res3.ad.impressionToken).toBe(res1.ad.impressionToken);
    });

    it('wait-state/end verifies caller owns wait state', async () => {
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue(null);
      mockPrisma.waitStateEvent.findFirst.mockResolvedValue({
        userId: 'usr-owner', // owned by different user
        deviceId: 'dev-1',
        sessionId: 'sess-1',
        eventType: 'wait_state_start',
        waitStateId: 'wait-1',
        toolType: 'vscode',
      });

      const endPayload = {
        waitStateId: 'wait-1',
        durationSeconds: 3,
        idempotencyKey: 'idem-end-1',
      };
      const signed = { ...endPayload, signature: hmacSign(endPayload) };

      await expect(svc.extension.recordWaitStateEnd('usr-hacker', signed)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

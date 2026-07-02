import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionService } from '../extension/extension.service';
import { LedgerService } from '../ledger/ledger.service';
import { FraudService } from '../fraud/fraud.service';
import { CampaignService } from '../campaign/campaign.service';
import { AdvertiserService } from '../advertiser/advertiser.service';
import { AdminService } from '../admin/admin.service';
import { AuditService } from '../audit/audit.service';
import { PayoutService } from '../payout/payout.service';

// ── Shared signing utility (no mocking needed — it's pure crypto) ──
import { signPayload } from '@waitlayer/shared';

// HMAC secret must match what ExtensionService uses
const HMAC_SECRET = 'dev-secret-change-me';

// ── Helpers ──
function hmacSign(payload: Record<string, unknown>): string {
  return signPayload(payload, HMAC_SECRET);
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
    count: vi.fn(),
  },
  // ── AdCreative ──
  adCreative: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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
    return Promise.resolve({ id: 'adv-ledger-' + recordedLedgerEntries.advertiser.length, ...args.data });
  });
  mockPrisma.earningsLedger.create.mockImplementation((args: any) => {
    recordedLedgerEntries.earnings.push(args.data);
    return Promise.resolve({ id: 'earn-ledger-' + recordedLedgerEntries.earnings.length, ...args.data });
  });
  mockPrisma.platformLedger.create.mockImplementation((args: any) => {
    recordedLedgerEntries.platform.push(args.data);
    return Promise.resolve({ id: 'plat-ledger-' + recordedLedgerEntries.platform.length, ...args.data });
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
}

function makeServices(): TestFixtures {
  // ConfigService mock — returns the HMAC secret
  const config = {
    get: vi.fn((key: string, fallback?: string) => {
      if (key === 'EXTENSION_HMAC_SECRET') return HMAC_SECRET;
      return fallback ?? null;
    }),
  } as any;

  // AuditService — real instance (its prisma is mocked)
  const audit = new AuditService(prismaRef);

  // LedgerService — real instance with mocked prisma
  const ledger = new LedgerService(prismaRef);

  // FraudService — real instance with mocked prisma and real ledger
  const fraud = new FraudService(prismaRef, ledger);

  // ExtensionService — real instance with all mocked deps
  const extension = new ExtensionService(prismaRef, audit, config, ledger, fraud);

  // CampaignService — real instance with mocked prisma
  const campaign = new CampaignService(prismaRef);

  // AdvertiserService — real instance with mocked prisma and real campaign service
  const advertiser = new AdvertiserService(prismaRef, campaign);

  // PayoutService — real instance with mocked prisma, real ledger and dummy paypal payouts provider
  const payout = new PayoutService(prismaRef, ledger, {} as any);

  // AdminService — real instance with mocked prisma and real audit service and payout service
  const admin = new AdminService(prismaRef, audit, payout);

  return { extension, ledger, fraud, campaign, advertiser, admin, audit, payout };
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

      const creative = await svc.campaign.createCreative(campaignId, {
        title: 'Best AI Tools',
        sponsoredMessage: 'Try our AI-powered code completion — free for 30 days!',
        destinationUrl: 'https://example.com/ai-tools',
        displayDomain: 'example.com',
      });
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

      const approvedCreative = await svc.campaign.approveCreative(creativeId);
      expect(approvedCreative.status).toBe('approved');

      // --- Step 5: Advertiser submits campaign ---
      // Reset campaign.findUnique for submitCampaign (must include creatives)
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        advertiserId: advertiserProfileId,
        status: 'draft',
        creatives: [{ id: creativeId, status: 'approved' }],
        submittedAt: null,
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campaignId,
        status: 'submitted',
        submittedAt: new Date(),
      });

      const submitted = await svc.advertiser.submitCampaign(campaignId, advertiserProfileId);
      expect(submitted.status).toBe('submitted');

      // --- Step 6: Admin approves campaign (→ active because approved creative exists) ---
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId,
        status: 'submitted',
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

      // $transaction for approveCampaign — must return [updatedCampaign, approval]
      mockPrisma.$transaction.mockImplementationOnce(async (arg: any) => {
        if (typeof arg === 'function') return arg(mockPrisma);
        return [
          { id: campaignId, status: 'active', approvedAt: new Date(), activatedAt: new Date() },
          { id: uid('ca'), campaignId, reviewerId: 'admin-1', decision: 'approved' },
        ];
      });

      const result = await svc.admin.approveCampaign(campaignId, 'admin-1');
      // approveCampaign returns the $transaction result array; status is on first element
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].status).toBe('active');
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
      mockPrisma.userSettings.findUnique.mockResolvedValue({ userId: DEV_USER_ID, adsEnabled: true });

      // Device ownership
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: DEV_USER_ID,
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
        impressionTokenHash: require('crypto').createHash('sha256').update(IMPRESSION_TOKEN).digest('hex'),
        renderedAt: new Date(),
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

      const result = await svc.extension.recordQualifiedImpression(signed);
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

      const result = await svc.extension.recordQualifiedImpression(signed);
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

      const result = await svc.extension.recordQualifiedImpression(signed);
      expect(result.qualified).toBe(false);
      expect(result.reason).toMatch(/fraud|limit/i);
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
        impressionTokenHash: require('crypto').createHash('sha256').update(IMPRESSION_TOKEN).digest('hex'),
        qualifiedAt: new Date(),
        campaign: {
          id: CAMPAIGN_ID,
          bidAmountMinor: 3_00,
          currency: 'USD',
          advertiserId: ADS_PROFILE_ID,
          bidType: 'cpc',
        },
      });

      // No existing click (idempotency)
      mockPrisma.adClick.findUnique.mockResolvedValue(null);
      mockPrisma.adClick.findFirst.mockResolvedValue(null);

      // Fraud click patterns: allowed
      // First adClick.count call: duplicate check (must be 0)
      // Second adClick.count call: rate limit (5 clicks/hour is fine)
      mockPrisma.adClick.count.mockResolvedValueOnce(0) // no existing click for this impression
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

      const result = await svc.extension.recordClick(signed);
      expect(result.clicked).toBe(true);

      // CPC campaigns generate advertiser debit + developer credit
      const advDebit = recordedLedgerEntries.advertiser.find((e: any) => e.entryType === 'debit');
      expect(advDebit).toBeDefined();
      expect(advDebit.amountMinor).toBe(3_00);

      const devCredit = recordedLedgerEntries.earnings.find((e: any) => e.entryType === 'credit');
      expect(devCredit).toBeDefined();
      expect(devCredit.status).toBe('estimated');
      expect(devCredit.amountMinor).toBe(180); // 60% of 300
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
        id: advUserId, email: 'biz@e2e.com', name: 'E2E Corp', role: 'advertiser', status: 'active',
      });
      mockPrisma.advertiser.create.mockResolvedValue({
        id: advProfileId, userId: advUserId, companyName: 'E2E Corp', billingEmail: 'biz@e2e.com',
      });
      await svc.advertiser.createProfile(advUserId, {
        companyName: 'E2E Corp', billingEmail: 'biz@e2e.com',
      });

      // ── Step 2: Create campaign ──
      mockPrisma.blockedCategory.findFirst.mockResolvedValue(null);
      mockPrisma.campaign.create.mockResolvedValue({
        id: campaignId, advertiserId: advProfileId, name: 'E2E Campaign',
        category: 'developer_tools', bidType: 'cpm', bidAmountMinor: 5_00,
        budgetTotalMinor: 500_00, budgetSpentMinor: 0, currency: 'USD', status: 'draft',
      });
      await svc.advertiser.createCampaign(advProfileId, {
        name: 'E2E Campaign', category: 'developer_tools', bidType: 'cpm',
        bidAmountMinor: 5_00, budgetTotalMinor: 500_00,
      });

      // ── Step 3: Create creative ──
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: campaignId, status: 'draft' });
      mockPrisma.adCreative.create.mockResolvedValue({
        id: creativeId, campaignId, title: 'E2E Ad', sponsoredMessage: 'E2E test ad message',
        destinationUrl: 'https://e2e.example.com', displayDomain: 'e2e.example.com', status: 'draft',
      });
      await svc.campaign.createCreative(campaignId, {
        title: 'E2E Ad', sponsoredMessage: 'E2E test ad message',
        destinationUrl: 'https://e2e.example.com', displayDomain: 'e2e.example.com',
      });

      // ── Step 4: Admin approves creative ──
      mockPrisma.adCreative.findUnique.mockResolvedValue({
        id: creativeId, campaignId, status: 'draft',
      });
      mockPrisma.adCreative.update.mockResolvedValue({
        id: creativeId, campaignId, status: 'approved',
      });
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId, status: 'draft',
        creatives: [{ id: creativeId, status: 'approved' }],
      });
      await svc.campaign.approveCreative(creativeId);

      // ── Step 5: Submit campaign ──
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId, advertiserId: advProfileId, status: 'draft',
        creatives: [{ id: creativeId, status: 'approved' }],
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campaignId, status: 'submitted', submittedAt: new Date(),
      });
      await svc.advertiser.submitCampaign(campaignId, advProfileId);

      // ── Step 6: Admin approves campaign → active ──
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campaignId, status: 'submitted',
        creatives: [{ id: creativeId, status: 'approved' }],
      });
      mockPrisma.campaignApproval.create.mockResolvedValue({
        id: uid('ca'), campaignId, reviewerId: adminUserId, decision: 'approved',
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
        id: deviceId, userId: devUserId, fingerprintHash: 'fp-e2e',
        toolType: 'claude_code', extensionVersion: '1.0.0', platform: 'linux',
      });
      await svc.extension.registerDevice(devUserId, {
        toolType: 'claude_code', fingerprintHash: 'fp-e2e',
        extensionVersion: '1.0.0', platform: 'linux',
      });

      // ── Step 8: Wait-state-start ──
      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId, userId: devUserId, fingerprintHash: 'fp-e2e', toolType: 'claude_code',
      });
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue(null);
      mockPrisma.waitStateEvent.create.mockResolvedValue({
        id: uid('wse'), userId: devUserId, deviceId, sessionId,
        eventType: 'wait_state_start', waitStateId, toolType: 'claude_code',
        idempotencyKey: 'idem-e2e-ws', createdAt: new Date(),
      });
      const wsPayload = {
        deviceId, sessionId, toolType: 'claude_code', waitStateId, idempotencyKey: 'idem-e2e-ws',
      };
      await svc.extension.recordWaitStateStart(devUserId, { ...wsPayload, signature: hmacSign(wsPayload) });

      // ── Step 9: Request ad ──
      mockPrisma.userSettings.findUnique.mockResolvedValue({ userId: devUserId, adsEnabled: true });
      mockPrisma.device.findUnique.mockResolvedValue({
        id: deviceId, userId: devUserId,
      });
      mockPrisma.adImpression.findFirst.mockResolvedValue(null);
      mockPrisma.adImpression.findMany.mockResolvedValue([]);
      mockPrisma.campaign.findMany.mockResolvedValue([
        {
          id: campaignId, advertiserId: advProfileId, name: 'E2E Campaign',
          status: 'active', category: 'developer_tools', bidType: 'cpm',
          bidAmountMinor: 5_00, budgetTotalMinor: 500_00, budgetSpentMinor: 0,
          currency: 'USD', frequencyCapPerHour: 2, frequencyCapPerDay: 6,
          creatives: [{
            id: creativeId, campaignId, title: 'E2E Ad',
            sponsoredMessage: 'E2E test ad message',
            displayDomain: 'e2e.example.com',
            destinationUrl: 'https://e2e.example.com', status: 'approved',
          }],
          countryTargeting: [],
        },
      ]);
      mockPrisma.adImpression.create.mockResolvedValue({
        id: impressionId, campaignId, creativeId, userId: devUserId,
        deviceId, sessionId, impressionTokenHash: require('crypto').createHash('sha256').update(impressionToken).digest('hex'),
        isBillable: false, createdAt: new Date(),
      });
      const adPayload = {
        deviceId, sessionId, waitStateId, toolType: 'claude_code', idempotencyKey: 'idem-e2e-ad',
      };
      const adResult = await svc.extension.requestAd(devUserId, { ...adPayload, signature: hmacSign(adPayload) });
      expect(adResult.ad).toBeDefined();
      expect(adResult.ad.campaignId).toBe(campaignId);

      // ── Step 10: Record rendered ──
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impressionId, impressionTokenHash: require('crypto').createHash('sha256').update(impressionToken).digest('hex'),
        renderedAt: null,
      });
      mockPrisma.adImpression.update.mockResolvedValue({
        id: impressionId, renderedAt: new Date(),
      });
      const rendPayload = {
        impressionToken, renderedAt: new Date().toISOString(),
        idempotencyKey: 'idem-e2e-rend',
      };
      await svc.extension.recordRendered({ ...rendPayload, signature: hmacSign(rendPayload) });

      // ── Step 11: Qualified impression → MONEY MOVES ──
      mockPrisma.adImpression.count.mockResolvedValue(5); // under fraud limit
      mockPrisma.trustScore.findUnique.mockResolvedValue({
        userId: devUserId, score: 55, level: 'normal',
      });
      mockPrisma.adImpression.findUnique.mockResolvedValue({
        id: impressionId, campaignId, creativeId, userId: devUserId,
        deviceId, sessionId,
        impressionTokenHash: require('crypto').createHash('sha256').update(impressionToken).digest('hex'),
        renderedAt: new Date(), qualifiedAt: null, isBillable: false,
        campaign: {
          id: campaignId, bidAmountMinor: 5_00, currency: 'USD',
          advertiserId: advProfileId, bidType: 'cpm',
        },
      });
      mockPrisma.adImpression.update.mockResolvedValue({
        id: impressionId, isBillable: true, qualifiedAt: new Date(), visibleDurationMs: 8000,
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campaignId, budgetSpentMinor: 5_00,
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
        impressionToken, qualifiedAt: new Date().toISOString(),
        visibleDurationMs: 8000, idempotencyKey: 'idem-e2e-qual',
      };
      const qualResult = await svc.extension.recordQualifiedImpression({
        ...qualPayload, signature: hmacSign(qualPayload),
      });
      expect(qualResult.qualified).toBe(true);

      // ── FINAL ASSERTIONS: All ledger entries correct ──
      // Advertiser debit: full bid amount
      const advDebits = recordedLedgerEntries.advertiser.filter((e: any) => e.entryType === 'debit');
      expect(advDebits.length).toBeGreaterThanOrEqual(1);
      const totalAdvCharged = advDebits.reduce((sum: number, e: any) => sum + e.amountMinor, 0);
      expect(totalAdvCharged).toBe(5_00); // $5.00 charged to advertiser

      // Developer earnings: 60% of bid (300 cents)
      const devCredits = recordedLedgerEntries.earnings.filter((e: any) => e.entryType === 'credit');
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
        id: deviceId, userId, fingerprintHash: 'fp-test', toolType: 'claude_code',
      });

      const payload = {
        deviceId, sessionId: uid('sess'),
        toolType: 'claude_code', waitStateId: uid('ws'),
        idempotencyKey: 'idem-bad-sig',
      };
      // Sign with wrong secret
      const wrongSig = signPayload(payload, 'wrong-secret');

      await expect(
        svc.extension.recordWaitStateStart(userId, { ...payload, signature: wrongSig }),
      ).rejects.toThrow(/Invalid request signature/);
    });

    it('rejects wait-state-start for device not owned by user', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: uid('dev'), userId: 'other-user',
      });

      const payload = {
        deviceId: uid('dev'),
        sessionId: uid('sess'),
        toolType: 'claude_code',
        waitStateId: uid('ws'),
        idempotencyKey: 'idem-wrong-dev',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      await expect(
        svc.extension.recordWaitStateStart(uid('u'), signed),
      ).rejects.toThrow(/Device does not belong/);
    });

    it('rejects campaign submit without approved creative', async () => {
      const advId = uid('advp');
      const campId = uid('camp');
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campId, advertiserId: advId, status: 'draft',
        creatives: [], // no creatives
      });

      await expect(
        svc.advertiser.submitCampaign(campId, advId),
      ).rejects.toThrow(/at least one creative/);
    });

    it('allows campaign submit when creatives exist and are not approved', async () => {
      const advId = uid('advp');
      const campId = uid('camp');
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: campId, advertiserId: advId, status: 'draft',
        creatives: [{ id: uid('cr'), status: 'draft' }],
      });
      mockPrisma.adCreative.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.campaign.update.mockResolvedValue({
        id: campId, status: 'submitted',
      });

      const res = await svc.advertiser.submitCampaign(campId, advId);
      expect(res.status).toBe('submitted');
      expect(mockPrisma.adCreative.updateMany).toHaveBeenCalledWith({
        where: { campaignId: campId, status: 'draft' },
        data: { status: 'pending_review' },
      });
    });

    it('handles idempotent wait-state-start (returns existing record)', async () => {
      mockPrisma.waitStateEvent.findUnique.mockResolvedValue({
        id: uid('wse'),
        userId: uid('u'),
        deviceId: uid('dev'),
        eventType: 'wait_state_start',
        idempotencyKey: 'idem-dup',
      });

      const payload = {
        deviceId: uid('dev'), sessionId: uid('sess'),
        toolType: 'claude_code', waitStateId: uid('ws'),
        idempotencyKey: 'idem-dup',
      };
      const signed = { ...payload, signature: hmacSign(payload) };

      const result = await svc.extension.recordWaitStateStart(uid('u'), signed);
      expect(result.eventType).toBe('wait_state_start');
      expect(result.idempotencyKey).toBe('idem-dup');
      // Should not call create
      expect(mockPrisma.waitStateEvent.create).not.toHaveBeenCalled();
    });
  });
});
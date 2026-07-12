import { z } from 'zod';

import {
  BidType,
  CampaignStatus,
  CreativeStatus,
  LedgerEntryType,
  LedgerStatus,
  PayoutProvider,
  PayoutStatus,
  TrustLevel,
  UserRole,
  UserStatus,
} from './enums';

const CampaignStatusSchema = z.nativeEnum(CampaignStatus);
const CreativeStatusSchema = z.nativeEnum(CreativeStatus);
const UserRoleSchema = z.nativeEnum(UserRole);
const UserStatusSchema = z.nativeEnum(UserStatus);
const TrustLevelSchema = z.nativeEnum(TrustLevel);
const BidTypeSchema = z.nativeEnum(BidType);
const PayoutStatusSchema = z.nativeEnum(PayoutStatus);
const PayoutProviderSchema = z.nativeEnum(PayoutProvider);
const LedgerStatusSchema = z.nativeEnum(LedgerStatus);
const LedgerEntryTypeSchema = z.nativeEnum(LedgerEntryType);

// ══════════════════════════════════════════════════════════
// Auth API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/auth/signup response
 *
 * `User`-shaped fields mirror the prisma `User` model surface that
 * `sanitizeUser` (apps/api/src/auth/auth.service.ts) actually exposes —
 * every field besides `passwordHash`. Keeping this exhaustive ensures
 * the client `parseResponse(SignupResponse, body)` survives the real
 * server payload rather than silently stripping fields that drift in.
 */
export const SignupUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  trustLevel: TrustLevelSchema.nullable(),
  country: z.string().nullable().optional(),
  emailVerified: z.boolean(),
  // The Prisma model defaults these to `false` (non-nullable); the contract
  // previously allowed `undefined`, which would force UI code to defensively
  // check both `false` and `undefined` for the "verified" badge. Align with
  // the DB so a missing field is indistinguishable from `false` everywhere.
  googleVerified: z.boolean(),
  githubVerified: z.boolean(),
  referralCode: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const SignupResponse = z.object({
  user: SignupUserSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

/** POST /api/v1/auth/login response */
export const LoginResponse = SignupResponse;

/** POST /api/v1/auth/refresh response */
export const RefreshResponse = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

/** GET /api/v1/auth/me response — full User surface minus secrets */
export const MeResponse = SignupUserSchema;

// ══════════════════════════════════════════════════════════
// Extension API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/extension/register-device response — full Device row */
export const RegisterDeviceResponse = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  fingerprintHash: z.string(),
  toolType: z.string(),
  publicKey: z.string().nullable().optional(),
  extensionVersion: z.string().optional(),
  platform: z.string().optional(),
  eventSecret: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
});

/** POST /api/v1/extension/wait-state/start response — matches WaitStateEvent
 * shape that the controller actually returns (toolType is propagated). */
export const WaitStateStartResponse = z.object({
  id: z.string(),
  userId: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  eventType: z.literal('wait_state_start'),
  waitStateId: z.string(),
  toolType: z.string(),
  createdAt: z.string().optional(),
});

/** POST /api/v1/extension/wait-state/end response */
export const WaitStateEndResponse = WaitStateStartResponse.extend({
  eventType: z.literal('wait_state_end'),
  duration: z.number().nonnegative(),
  signature: z.string(),
  idempotencyKey: z.string(),
});

/** POST /api/v1/extension/ad-request response */
export const AdRequestResponse = z.object({
  ad: z
    .object({
      impressionToken: z.string().min(1),
      campaignId: z.string().min(1),
      creativeId: z.string().min(1),
      title: z.string(),
      message: z.string(),
      label: z.string(),
      displayDomain: z.string(),
      destinationUrl: z.string().refine((v) => typeof v === 'string' && v.startsWith('https://'), {
        message: 'destinationUrl must be an https:// URL',
      }),
      ctaText: z.string().nullable().optional(),
    })
    .nullable(),
});

/** POST /api/v1/extension/ad-rendered response */
export const AdRenderedResponse = z.object({
  id: z.string(),
  impressionTokenHash: z.string(),
  renderedAt: z.string(),
});

/** POST /api/v1/extension/impression-qualified response */
export const QualifiedImpressionResponse = z.discriminatedUnion('qualified', [
  z.object({
    qualified: z.literal(true),
    impressionId: z.string(),
    alreadyQualified: z.boolean().optional(),
  }),
  z.object({
    qualified: z.literal(false),
    reason: z.string(),
    minimumRequired: z.number().optional(),
    actual: z.number().optional(),
    impressionId: z.string().optional(),
  }),
]);

/** POST /api/v1/extension/click response */
export const AdClickResponse = z.discriminatedUnion('clicked', [
  z.object({
    clicked: z.literal(true),
    clickId: z.string(),
    isDuplicate: z.boolean().optional(),
  }),
  z.object({
    clicked: z.literal(false),
    reason: z.string(),
  }),
]);

// ══════════════════════════════════════════════════════════
// Ledger API Contracts
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// Payout API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/payout/method response */
export const PayoutMethodResponse = z.object({
  id: z.string(),
  userId: z.string(),
  provider: PayoutProviderSchema,
  destination: z.string(),
  currency: z.string(),
  isVerified: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** POST /api/v1/payout/request response — full PayoutRequest row shape */
export const PayoutAllocationResponse = z.object({
  id: z.string(),
  earningsEntryId: z.string(),
  payoutRequestId: z.string().optional(),
  amountMinor: z.coerce.bigint().nonnegative(),
  createdAt: z.string().optional(),
});

export const PayoutRequestResponse = z.object({
  id: z.string(),
  userId: z.string(),
  // Server-side this is a required FK on PayoutRequest (database NOT NULL).
  // The shared Zod contract previously marked it optional, which masked
  // legitimate undefined values on clients that compared against the schema.
  // Align the contract with the DB and the service's stored value.
  payoutAccountId: z.string(),
  status: PayoutStatusSchema,
  requestedAmountMinor: z.coerce.bigint().nonnegative(),
  approvedAmountMinor: z.coerce.bigint().nonnegative().nullable().optional(),
  currency: z.string(),
  reviewerId: z.string().nullable().optional(),
  reviewNote: z.string().nullable().optional(),
  processedAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  providerTxId: z.string().nullable().optional(),
  failureReason: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  allocations: z.array(PayoutAllocationResponse).optional(),
});

/** GET /api/v1/payout/available response */
export const PayoutAvailableResponse = z.object({
  entries: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string(),
        amountMinor: z.coerce.bigint().nonnegative(),
        currency: z.string(),
        status: LedgerStatusSchema,
        entryType: LedgerEntryTypeSchema,
        createdAt: z.string(),
      }),
    )
    .optional(),
  totalMinor: z.coerce.bigint().nonnegative(),
  currency: z.string(),
  count: z.number().nonnegative(),
  totalsByCurrency: z.record(z.string(), z.coerce.bigint().nonnegative()).optional(),
});

// ══════════════════════════════════════════════════════════
// Ledger API Contracts
// ══════════════════════════════════════════════════════════

/** GET /api/v1/ledger/balance response — used by extension status bar */
export const LedgerBalanceResponse = z.object({
  available: z.object({
    amountMinor: z.coerce.bigint().nonnegative(),
    currency: z.string(),
    byCurrency: z.record(z.string(), z.coerce.bigint().nonnegative()).optional(),
  }),
  pending: z.object({
    amountMinor: z.coerce.bigint().nonnegative(),
    currency: z.string(),
    byCurrency: z.record(z.string(), z.coerce.bigint().nonnegative()).optional(),
  }),
  total: z.object({
    amountMinor: z.coerce.bigint().nonnegative(),
    currency: z.string(),
    byCurrency: z.record(z.string(), z.coerce.bigint().nonnegative()).optional(),
  }),
  paidOut: z.object({
    amountMinor: z.coerce.bigint().nonnegative(),
    currency: z.string(),
    byCurrency: z.record(z.string(), z.coerce.bigint().nonnegative()).optional(),
  }),
});

// ══════════════════════════════════════════════════════════
// Campaign API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/advertiser/campaigns response — full Campaign row */
export const CreateCampaignResponse = z.object({
  id: z.string(),
  name: z.string(),
  advertiserId: z.string(),
  status: CampaignStatusSchema,
  category: z.string(),
  bidType: BidTypeSchema,
  bidAmountMinor: z.coerce.bigint().positive(),
  budgetTotalMinor: z.coerce.bigint().nonnegative(),
  budgetSpentMinor: z.coerce.bigint().nonnegative(),
  currency: z.string(),
  frequencyCapPerHour: z.number().int().nonnegative().optional(),
  frequencyCapPerDay: z.number().int().nonnegative().optional(),
  qualityScore: z.number().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  activatedAt: z.string().nullable().optional(),
  pausedAt: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** POST /api/v1/campaigns/:id/creatives response */
export const CreativeResponse = z.object({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  sponsoredMessage: z.string(),
  destinationUrl: z.string(),
  displayDomain: z.string(),
  ctaText: z.string().nullable().optional(),
  status: CreativeStatusSchema,
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

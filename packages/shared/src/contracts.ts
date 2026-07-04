import { z } from 'zod';
import { CampaignStatus, CreativeStatus } from './enums';

const CampaignStatusSchema = z.nativeEnum(CampaignStatus);
const CreativeStatusSchema = z.nativeEnum(CreativeStatus);

/**
 * Roles recognized by the auth system. `RoleSchema` is the runtime shape
 * source; the TypeScript `Role` enum lives in `./types.ts`.
 */
export const RoleSchema = z.enum(['developer', 'advertiser', 'admin', 'super_admin']);

// ══════════════════════════════════════════════════════════
// Auth API Contracts
// ══════════════════════════════════════════════════════════

/**
 * Request body shapes for the auth endpoints. The TypeScript counterparts
 * (`SignupRequest`, `LoginRequest`) live in `./types.ts` — keep them in
 * sync manually. We intentionally do not re-export them under the same
 * name to avoid `Module has already exported a member` ambiguity.
 */
export const RefreshRequest = z.object({
  refreshToken: z.string().min(1),
});

/** POST /api/v1/auth/signup response */
export const SignupResponse = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['developer', 'advertiser', 'admin']),
    emailVerified: z.boolean(),
  }),
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

/** GET /api/v1/auth/me response */
export const MeResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['developer', 'advertiser', 'admin']),
  status: z.string(),
  trustLevel: z.enum(['new', 'basic', 'trusted', 'verified', 'restricted']).nullable().optional(),
  country: z.string().nullable().optional(),
  emailVerified: z.boolean(),
  googleVerified: z.boolean().optional(),
  githubVerified: z.boolean().optional(),
  referralCode: z.string().nullable().optional(),
  createdAt: z.string(),
});

// ══════════════════════════════════════════════════════════
// Extension API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/extension/register-device response */
export const RegisterDeviceResponse = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  fingerprintHash: z.string(),
  toolType: z.string(),
  eventSecret: z.string().optional(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
});

/** POST /api/v1/extension/wait-state/start response */
export const WaitStateStartResponse = z.object({
  id: z.string(),
  userId: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  eventType: z.literal('wait_state_start'),
  waitStateId: z.string(),
  toolType: z.string(),
});

/** POST /api/v1/extension/wait-state/end response */
export const WaitStateEndResponse = z.object({
  id: z.string(),
  userId: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  eventType: z.literal('wait_state_end'),
  waitStateId: z.string(),
  duration: z.number().nonnegative(),
  signature: z.string(),
  idempotencyKey: z.string(),
  createdAt: z.string(),
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
      destinationUrl: z.string(),
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
// Payout API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/payout/method response */
export const PayoutMethodResponse = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.string(),
  destination: z.string(),
  currency: z.string(),
  isActive: z.boolean(),
});

/** POST /api/v1/payout/request response */
export const PayoutRequestResponse = z.object({
  id: z.string(),
  userId: z.string(),
  status: z.enum(['requested', 'approved', 'processing', 'paid', 'rejected']),
  requestedAmountMinor: z.number().nonnegative(),
  currency: z.string(),
  allocations: z
    .array(
      z.object({
        id: z.string(),
        earningsEntryId: z.string(),
        amountMinor: z.number().nonnegative(),
      }),
    )
    .optional(),
});

/** GET /api/v1/payout/available response */
export const PayoutAvailableResponse = z.object({
  entries: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string(),
        amountMinor: z.number(),
        currency: z.string(),
        status: z.string(),
        entryType: z.string(),
        createdAt: z.string(),
      }),
    )
    .optional(),
  totalMinor: z.number().nonnegative(),
  currency: z.string(),
});

// ══════════════════════════════════════════════════════════
// Ledger API Contracts
// ══════════════════════════════════════════════════════════

/** GET /api/v1/ledger/balance response — used by extension status bar */
export const LedgerBalanceResponse = z.object({
  available: z.object({
    amountMinor: z.number().nonnegative(),
    currency: z.string(),
  }),
  pending: z.object({
    amountMinor: z.number().nonnegative(),
    currency: z.string(),
  }),
  total: z.object({
    amountMinor: z.number().nonnegative(),
    currency: z.string(),
  }),
  paidOut: z.object({
    amountMinor: z.number().nonnegative(),
    currency: z.string(),
  }),
});

// ══════════════════════════════════════════════════════════
// Campaign API Contracts
// ══════════════════════════════════════════════════════════

/** POST /api/v1/advertiser/campaigns response */
export const CreateCampaignResponse = z.object({
  id: z.string(),
  name: z.string(),
  advertiserId: z.string(),
  status: CampaignStatusSchema,
  category: z.string(),
  bidType: z.enum(['cpm', 'cpc']),
  bidAmountMinor: z.number().nonnegative(),
  budgetTotalMinor: z.number().nonnegative(),
  budgetSpentMinor: z.number().nonnegative(),
  currency: z.string(),
  frequencyCapPerHour: z.number().int().nonnegative().optional(),
  frequencyCapPerDay: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
});

/** POST /api/v1/campaigns/:id/creatives response */
export const CreativeResponse = z.object({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  sponsoredMessage: z.string(),
  destinationUrl: z.string(),
  displayDomain: z.string(),
  status: CreativeStatusSchema,
  rejectionReason: z.string().nullable().optional(),
  createdAt: z.string(),
});

/**
 * Thin runtime helper: parse an API response body against a Zod schema and
 * return either the parsed value or a typed Error. Use this in web/api
 * clients to surface contract drift early instead of letting `unknown`
 * drift silently through the call sites. The ZodError is converted into a
 * plain Error including only the first issue path to keep logs readable.
 */
export function parseResponse<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  ctx?: { endpoint?: string },
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.join('.') ?? '<root>';
    const where = ctx?.endpoint ? ` for ${ctx.endpoint}` : '';
    throw new Error(
      `Contract violation${where}: expected schema at "${path}" — ${issue?.message ?? 'invalid response'}`,
    );
  }
  return result.data as z.infer<T>;
}
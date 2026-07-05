import type {
  UserRole,
  UserStatus,
  TrustLevel,
  BidType,
  ToolType,
  LedgerEntryType,
  LedgerStatus,
  FraudFlagType,
  FraudSeverity,
} from './enums';

// ── Auth ──
export interface SignupRequest {
  email: string;
  password: string;
  role: UserRole.DEVELOPER | UserRole.ADVERTISER;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    trustLevel: TrustLevel;
  };
  accessToken: string;
  refreshToken: string;
}

// ── Extension Events ──
export interface WaitStateStartEvent {
  deviceId: string;
  sessionId: string;
  toolType: ToolType;
  waitStateId: string;
  timestamp: string;
  idempotencyKey: string;
  signature: string;
}

export interface WaitStateEndEvent {
  waitStateId: string;
  duration: number;
  idempotencyKey: string;
  signature: string;
}

export interface AdRequestEvent {
  deviceId: string;
  sessionId: string;
  waitStateId: string;
  toolType: ToolType;
  allowedCategories?: string[];
  blockedCategories?: string[];
  idempotencyKey: string;
  signature: string;
}

export interface AdResponse {
  impressionToken: string;
  campaignId: string;
  creativeId: string;
  title: string;
  message: string;
  label: string; // "Sponsored" or "Ad"
  displayDomain: string;
  destinationUrl: string;
}

export interface AdRenderedEvent {
  impressionToken: string;
  renderedAt: string;
  visibleSurface?: number;
  idempotencyKey: string;
  signature: string;
}

export interface ImpressionQualifiedEvent {
  impressionToken: string;
  qualifiedAt: string;
  visibleDurationMs: number;
  idempotencyKey: string;
  signature: string;
}

export interface ClickEvent {
  impressionToken: string;
  clickedAt: string;
  idempotencyKey: string;
  signature: string;
}

// ── Developer Dashboard ──
export interface DeveloperDashboard {
  estimatedEarnings: number;
  confirmedEarnings: number;
  pendingEarnings: number;
  heldEarnings: number;
  availableForPayout: number;
  lifetimeEarnings: number;
  trustLevel: TrustLevel;
  payoutHoldStatus: {
    isHeld: boolean;
    reason?: string;
    releaseDate?: string;
  };
}

// ── Campaign ──
export interface CreateCampaignRequest {
  name: string;
  category: string;
  sponsoredMessage: string;
  destinationUrl: string;
  bidType: BidType;
  bidAmount: number;
  budgetTotal: number;
  targeting: {
    countries?: string[];
    tools?: ToolType[];
    developerCategories?: string[];
    stackInterests?: string[];
  };
  frequencyCaps: {
    perHour: number;
    perDay: number;
  };
}

// ── Ledger ──
export interface LedgerEntry {
  id: string;
  userId?: string;
  advertiserId?: string;
  campaignId?: string;
  impressionId?: string;
  clickId?: string;
  description?: string;
  heldByFlagId?: string;
  entryType: LedgerEntryType;
  status: LedgerStatus;
  amountMinor: number;
  currency: string;
  availableAt?: string;
  idempotencyKey: string;
  createdAt: string;
  // Stripe tracking columns — added in the R16 dispute-freeze migration.
  // The AdvertiserLedger model (whose read-path serves the admin dashboard
  // and the advertiser portal) carries these fields; consumers may want to
  // reconciliate them against Stripe events in their UI. Nullable for
  // legacy rows and rows unrelated to Stripe billing (spend entries from
  // impressions, fraud holds, payouts, etc.).
  stripePaymentIntentId?: string | null;
  stripeDisputeId?: string | null;
}

// ── Session (server-managed auth — mirrored from the Prisma Session model) ──
export interface Session {
  id: string;
  userId: string;
  /** SHA-256 of the JWT token (NOT the raw token) — always present for
   *  active rows. Nullable in the type for forward compat. */
  tokenHash: string;
  /** Token family string for refresh-rotation tracking — nullable for
   *  legacy rows that predate family tracking. */
  tokenFamily?: string | null;
  deviceHash?: string | null;
  ipHash?: string | null;
  /** Boolean flag — true when the session is revoked by server-side
   *  action (e.g. logout, password change, admin revoke). Not a DateTime. */
  revoked: boolean;
  /** Same instant as the refresh JWT `exp` — drives the 7d-grace-window
   *  deleteMany in the session-cleanup cron (indexed on this column). */
  expiresAt: string;
  createdAt: string;
}

// ── Payout ──
export interface PayoutRequestPayload {
  payoutAccountId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

// ── Fraud ──
export interface FraudFlagPayload {
  userId?: string;
  deviceId?: string;
  campaignId?: string;
  impressionId?: string;
  clickId?: string;
  flagType: FraudFlagType;
  severity: FraudSeverity;
  evidence: Record<string, unknown>;
}

// ── Trust Score ──
export interface TrustScoreComponents {
  accountAge: number;
  emailVerified: number;
  googleVerified: number;
  githubVerified: number;
  deviceConsistency: number;
  activityPattern: number;
  payoutHistory: number;
  fraudPenalty: number;
}

// ── API Response Wrapper ──
export interface ApiResponse<T> {
  data: T;
  requestId: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

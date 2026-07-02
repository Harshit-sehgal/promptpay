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
  entryType: LedgerEntryType;
  status: LedgerStatus;
  amountMinor: number;
  currency: string;
  availableAt?: string;
  idempotencyKey: string;
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

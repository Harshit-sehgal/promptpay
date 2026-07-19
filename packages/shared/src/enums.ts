// ── User & Account ──
export enum UserRole {
  DEVELOPER = 'developer',
  ADVERTISER = 'advertiser',
  ADMIN = 'admin',
  SUPPORT = 'support',
  SUPER_ADMIN = 'super_admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  RESTRICTED = 'restricted',
  BANNED = 'banned',
  DELETED = 'deleted',
}

export enum TrustLevel {
  NEW = 'new',
  LOW_TRUST = 'low_trust',
  NORMAL = 'normal',
  HIGH_TRUST = 'high_trust',
  RESTRICTED = 'restricted',
  BANNED = 'banned',
}

// ── Campaign ──
export enum CampaignStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  ACTIVE = 'active',
  PAUSED = 'paused',
  REJECTED = 'rejected',
  ARCHIVED = 'archived',
}

export enum CreativeStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAUSED = 'paused',
}

export enum BidType {
  CPM = 'cpm',
  CPC = 'cpc',
}
export enum ToolType {
  VSCODE = 'vscode',
  CURSOR = 'cursor',
  CLINE = 'cline',
  WINDSURF = 'windsurf',
  AIDER = 'aider',
  CODEX_CLI = 'codex_cli',
  CLAUDE_CODE = 'claude_code',
  TERMINAL = 'terminal',
  BROWSER = 'browser',
}

// ── Ledger ──
export enum LedgerEntryType {
  DEBIT = 'debit',
  CREDIT = 'credit',
  HOLD = 'hold',
  RELEASE = 'release',
  REVERSAL = 'reversal',
  PAYOUT = 'payout',
  REFUND = 'refund',
  RESERVE = 'reserve',
  FEE = 'fee',
}

export enum LedgerStatus {
  ESTIMATED = 'estimated',
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  HELD = 'held',
  REVERSED = 'reversed',
  PAID = 'paid',
  VOID = 'void',
}

// ── Payout ──
export enum PayoutProvider {
  MANUAL = 'manual',
  PAYPAL_EMAIL = 'paypal_email',
  PAYPAL_PAYOUTS = 'paypal_payouts',
  STRIPE_CONNECT = 'stripe_connect',
  PAYONEER = 'payoneer',
  WISE = 'wise',
  RAZORPAY = 'razorpay',
}

export enum PayoutStatus {
  DRAFT = 'draft',
  REQUESTED = 'requested',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PROCESSING = 'processing',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// ── Fraud ──
export enum FraudFlagType {
  IMPRESSION_RATE_LIMIT = 'impression_rate_limit',
  CLICK_RATE_LIMIT = 'click_rate_limit',
  DUPLICATE_DEVICE = 'duplicate_device',
  SUSPICIOUS_CTR = 'suspicious_ctr',
  IMPOSSIBLE_VOLUME = 'impossible_volume',
  SHARED_PAYOUT_DESTINATION = 'shared_payout_destination',
  VPN_PROXY_PATTERN = 'vpn_proxy_pattern',
  EMULATOR_VM_PATTERN = 'emulator_vm_pattern',
  RAPID_EARNING_SPIKE = 'rapid_earning_spike',
  COUNTRY_DEVICE_CHANGE = 'country_device_change',
  REPEATED_CLICK_ABUSE = 'repeated_click_abuse',
  SELF_CLICKING = 'self_clicking',
  AUTOMATED_PATTERN = 'automated_pattern',
  DUPLICATE_ACCOUNT = 'duplicate_account',
}

export enum FraudFlagStatus {
  OPEN = 'open',
  REVIEWING = 'reviewing',
  RESOLVED_VALID = 'resolved_valid',
  RESOLVED_INVALID = 'resolved_invalid',
  ESCALATED = 'escalated',
}

export enum FraudSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ApprovalDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CHANGES_REQUESTED = 'changes_requested',
}

export enum RecoveryDebtCaseStatus {
  OPEN = 'open',
  IN_COLLECTIONS = 'in_collections',
  RECOVERED = 'recovered',
  WRITTEN_OFF = 'written_off',
  CLOSED = 'closed',
}

export enum ReferralStatus {
  PENDING = 'pending',
  REWARDED = 'rewarded',
}

// ── Extension WaitState / Ad Lifecycle Event Types ──
// schema-gap: the `WaitStateEvent.eventType` Prisma enum (DB name
// `EventType`, members `wait_state_start`, `wait_state_end`, `ad_request`,
// `ad_rendered`, `qualified_impression`, `click`, `report_ad`) had no shared
// TS counterpart. Every other DB enum has a mirror here; this was the sole
// outlier, forcing client code that needs these constants to either import
// `@waitlayer/db` (splitting the package boundary) or hardcode strings (no
// single source of truth). Added as a pure additive export with a clear
// disambiguating name (`WaitStateEventType`) — using `EventType` here would
// shadow a common global name and risk confusion in callers. Existing
// hardcoded string sites across `apps/api` are unchanged for now; consumers
// can migrate incrementally and a future sweep can replace literals with
// `WaitStateEventType.X`. Member values are byte-identical to the Prisma
// enum so a swap from string literal to enum is a no-op at the DB layer.
export enum WaitStateEventType {
  WAIT_STATE_START = 'wait_state_start',
  WAIT_STATE_END = 'wait_state_end',
  AD_REQUEST = 'ad_request',
  AD_RENDERED = 'ad_rendered',
  QUALIFIED_IMPRESSION = 'qualified_impression',
  CLICK = 'click',
  REPORT_AD = 'report_ad',
}
// ── Prohibited Ad Categories ──
export const PROHIBITED_CATEGORIES = [
  'gambling',
  'adult_content',
  'illegal_products',
  'fake_investment_schemes',
  'malware',
  'phishing',
  'get_rich_quick',
  'shady_crypto',
  'political_ads',
  'deceptive_financial',
  'fake_ai_tools',
] as const;

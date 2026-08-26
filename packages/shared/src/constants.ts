import { UserRole } from './enums';

/*
 * The float `REVENUE_SPLIT` / `LAUNCH_INCENTIVE_SPLIT` constants were removed:
 * nothing imported them, and they duplicated — in lossy floating point — the
 * integer basis points that `LedgerMathTrait.calculateSplit` is the single
 * source of truth for. Two copies of a money rule is one too many; the ledger
 * keeps the authoritative integer version.
 */

/** Minimum visible duration in ms for a qualified impression */
export const MINIMUM_VISIBLE_DURATION_MS = 5000;

/** Payout thresholds */
export const PAYOUT = {
  MINIMUM_THRESHOLD_USD: 10_00, // $10 in cents
  MINIMUM_THRESHOLD_MINOR: 10_00,
  CURRENCY: 'USD',
} as const;

/** Payout hold periods in days */
export const PAYOUT_HOLD_DAYS = {
  NEW_ACCOUNT: 30,
  NORMAL: 14,
  HIGH_TRUST: 7,
  RESTRICTED: -1, // indefinite (negative = never)
} as const;

/** Trust score defaults */
export const TRUST_SCORE = {
  INITIAL: 40,
  MIN: 0,
  MAX: 100,
  THRESHOLDS: {
    LOW_TRUST: 25,
    NORMAL: 50,
    HIGH_TRUST: 75,
  },
} as const;

/** Rate limits */
export const RATE_LIMITS = {
  IMPRESSIONS_PER_USER_PER_HOUR: 60,
  IMPRESSIONS_PER_DEVICE_PER_HOUR: 60,
  IMPRESSIONS_PER_IP_PER_HOUR: 120,
  CLICKS_PER_USER_PER_HOUR: 30,
  CLICKS_PER_IMPRESSION: 1,
  EVENTS_PER_SECOND_PER_DEVICE: 5,
} as const;

/** Ad serving */
export const AD_SERVING = {
  MAX_ADS_PER_HOUR_DEFAULT: 6,
  // Keep every client below the API DTO's @Max boundary. This is the
  // platform-wide exposure cap; clients must not advertise a value the API
  // will reject.
  MAX_ADS_PER_HOUR_MAX: 12,
  MAX_ADS_PER_HOUR_MIN: 1,
  MIN_CAMPAIGN_BUDGET_MINOR: 50_00, // $50 minimum
  MAX_CAMPAIGN_BUDGET_MINOR: 1_000_000_00, // $1M max
  DEFAULT_FREQUENCY_CAP_PER_HOUR: 2,
  DEFAULT_FREQUENCY_CAP_PER_DAY: 6,
} as const;

/** Prohibited data — these fields must NEVER appear in extension/CLI events */
export const PROHIBITED_DATA_FIELDS = [
  'source_code',
  'file_contents',
  'file_names',
  'private_prompts',
  'private_completions',
  'clipboard_contents',
  'terminal_commands',
  'repository_contents',
  'project_names',
] as const;

/** Maximum ad message length */
export const MAX_AD_MESSAGE_LENGTH = 80;

/** Roles a user is permitted to self-assign at signup / OAuth registration.
 *  Privileged roles (admin, support, super_admin) must NEVER be reachable from
 *  self-service signup — they are granted only via an admin escalation path. */
export const SIGNUP_ALLOWED_ROLES = [UserRole.DEVELOPER, UserRole.ADVERTISER] as const;

export type SignupAllowedRole = (typeof SIGNUP_ALLOWED_ROLES)[number];

/** Default company name used when creating an advertiser profile without one */
export const DEFAULT_COMPANY_NAME = 'Unnamed Company';

/** Referral program */
export const REFERRAL = {
  /** Reward paid to the referrer once the referred user qualifies */
  REWARD_AMOUNT_MINOR: 5_00, // $5 in cents
  CURRENCY: 'USD',
  /** Minimum first payout amount (in cents) the referred user must receive before reward triggers */
  FIRST_PAYOUT_THRESHOLD_MINOR: 10_00, // $10 in cents
} as const;

/**
 * Normalized false-positive report reasons (P1 #16). Shared by the API
 * (DTO validation) and the VS Code extension (quick-pick values) so the two
 * cannot drift. The `other` value is the escape hatch that may carry a
 * bounded free-text note.
 */
export const FALSE_POSITIVE_REASONS = [
  'actively_working',
  'no_ai_generation',
  'unrelated_activity',
  'other',
] as const;

export type FalsePositiveReason = (typeof FALSE_POSITIVE_REASONS)[number];

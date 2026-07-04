import { UserRole } from './enums';

/** Revenue split defaults */
export const REVENUE_SPLIT = {
  USER: 0.6,         // 60% to developer
  PLATFORM: 0.3,     // 30% to platform
  RESERVE: 0.1,      // 10% fraud/payment reserve
} as const;

/** Launch incentive split */
export const LAUNCH_INCENTIVE_SPLIT = {
  USER: 0.8,         // 80% to developer for first 3 months
  PLATFORM: 0.1,     // 10% to platform
  RESERVE: 0.1,      // 10% fraud/payment reserve
} as const;

/** Minimum visible duration in ms for a qualified impression */
export const MINIMUM_VISIBLE_DURATION_MS = 5000;

/** Payout thresholds */
export const PAYOUT = {
  MINIMUM_THRESHOLD_USD: 10_00,       // $10 in cents
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
  MAX_ADS_PER_HOUR_MAX: 20,
  MAX_ADS_PER_HOUR_MIN: 1,
  MIN_CAMPAIGN_BUDGET_MINOR: 50_00,    // $50 minimum
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
export const SIGNUP_ALLOWED_ROLES = [
  UserRole.DEVELOPER,
  UserRole.ADVERTISER,
] as const;

export type SignupAllowedRole = (typeof SIGNUP_ALLOWED_ROLES)[number];

/** Default company name used when creating an advertiser profile without one */
export const DEFAULT_COMPANY_NAME = 'Unnamed Company';

/** Referral program */
export const REFERRAL = {
  /** Reward paid to the referrer once the referred user qualifies */
  REWARD_AMOUNT_MINOR: 5_00,         // $5 in cents
  CURRENCY: 'USD',
  /** Minimum first payout amount (in cents) the referred user must receive before reward triggers */
  FIRST_PAYOUT_THRESHOLD_MINOR: 10_00, // $10 in cents
} as const;

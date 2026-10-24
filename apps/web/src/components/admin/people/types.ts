import type { WaitlistStatus } from '@/lib/api/services';

export type { WaitlistStatus };

export const WAITLIST_STATUSES: WaitlistStatus[] = ['pending', 'invited', 'onboarded', 'declined'];

export type PeopleTab = 'registered' | 'waitlist';

/** The shareable view: the active tab, its filters and the page. Mirrored to the URL. */
export interface PeopleQuery {
  tab: PeopleTab;
  q: string;
  role: string;
  status: string;
  country: string;
  verified: string;
  page: number;
}

export interface PeopleSummary {
  users: {
    total: number;
    byRole: Record<string, number>;
    byStatus: Record<string, number>;
    emailVerified: number;
    twoFactorEnabled: number;
    last7d: number;
    last30d: number;
  };
  waitlist: {
    total: number;
    byStatus: Record<string, number>;
    last7d: number;
    last30d: number;
  };
  signupsByDay: Array<{ date: string; users: number; waitlist: number }>;
}

export interface PersonRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  trustLevel: string;
  country: string | null;
  emailVerified: boolean;
  googleVerified: boolean;
  githubVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  companyName: string | null;
  deviceCount: number;
  lastSeenAt: string | null;
}

export interface PersonDetail extends PersonRow {
  referralCode: string | null;
  updatedAt: string;
  advertiser: {
    companyName: string;
    billingEmail: string;
    websiteUrl: string | null;
    trustStatus: string;
  } | null;
  consents: Array<{ purpose: string; version: string; granted: boolean; createdAt: string }>;
  devices: Array<{
    id: string;
    toolType: string;
    platform: string | null;
    extensionVersion: string | null;
    createdAt: string;
    lastSeenAt: string | null;
  }>;
  referredBy: { id: string; email: string } | null;
  referralsMade: number;
  openFlags: number;
}

export interface WaitlistRow {
  id: string;
  email: string;
  company: string | null;
  country: string | null;
  status: WaitlistStatus;
  consent: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  registeredUserId: string | null;
}

export interface ListResponse<Row> {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
}

export interface ExportResponse<Row> {
  rows: Row[];
  truncated: boolean;
}

export const PAGE_SIZE = 25;

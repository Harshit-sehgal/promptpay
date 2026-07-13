import {
  // Response schemas (runtime + type source)
  CreateCampaignResponse,
  CreativeResponse,
  LedgerBalanceResponse,
  PayoutAvailableResponse,
  PayoutMethodResponse,
  PayoutRequestResponse,
} from '@waitlayer/shared';

import api from './client';

type AxiosLikeResponse<T> = { data: T; status: number };

/**
 * Wrap a parsed value in an AxiosResponse-shaped object so existing call
 * sites that read `.data` keep working. The `parseResponse` helper still
 * throws on contract drift — only the *shape* of what `authApi.signup` etc.
 * return is preserved.
 */
function ok<T>(parsed: T, status = 200): AxiosLikeResponse<T> {
  return { data: parsed, status };
}

export const DEVELOPER_LEDGER_API_KEY_SCOPES = ['ledger:read'] as const;

/**
 * The web client coerces request bodies through Zod at the API boundary so
 * a missing/wrong field on the front end throws at the call site rather
 * than producing a 4xx the user sees as a generic error. After every
 * mutation the response is parsed through the matching Zod schema —
 * `parseResponse` throws on a contract drift so it can't silently leak.
 *
 * Auth flows (login/signup/google/refresh/logout/me) are handled by the
 * Next.js Route Handlers at app/api/auth/_/route.ts together with
 * lib/auth-context.tsx — those no longer go through authApi because
 * their bodies are stripped of tokens by the Route Handlers (the API's
 * raw accessToken/refreshToken response fields don't reach the browser
 * anymore, so parsing them against the full Zod contract would throw).
 * Only the non-token auth endpoints (password reset, email verify) remain
 * here.
 *
 * Keep this file in sync with `packages/shared/contracts.ts` — when a
 * request schema changes there, the input type here updates automatically.
 */

export const authApi = {
  forgotPassword: (email: string) => api.post('/auth/password/forgot', { email }),
  resetPassword: (token: string, newPassword: string) =>
    api.post('/auth/password/reset', { token, newPassword }),
  confirmEmailVerification: (token: string) => api.post('/auth/verify-email/confirm', { token }),
  requestEmailVerification: () => api.post('/auth/verify-email/request'),
  setup2fa: () => api.post('/auth/2fa/setup'),
  enable2fa: (token: string) => api.post('/auth/2fa/enable', { token }),
  disable2fa: (token: string) => api.post('/auth/2fa/disable', { token }),
};

export const developerApi = {
  getDashboard: () => api.get('/developer/dashboard'),
  getEarnings: (params?: Record<string, unknown>) => api.get('/developer/earnings', { params }),
  getSettings: () => api.get('/developer/settings'),
  getTrust: () => api.get('/developer/trust'),
  updateSettings: (data: Record<string, unknown>) => api.patch('/developer/settings', data),
  exportData: () => api.post('/developer/export-data'),
  deleteAccount: (data: {
    confirmation: 'DELETE_MY_ACCOUNT';
    currentPassword?: string;
    googleIdToken?: string;
  }) => api.post('/developer/delete-account', data),
  listApiKeys: () => api.get('/developer/api-keys'),
  createLedgerApiKey: () =>
    api.post('/developer/api-keys', { scopes: [...DEVELOPER_LEDGER_API_KEY_SCOPES] }),
  createApiKey: (data: { scopes: string[]; advertiserId?: string; expiresAt?: string }) =>
    api.post('/developer/api-keys', data),
  revokeApiKey: (id: string) => api.delete(`/developer/api-keys/${id}`),
};

export const advertiserApi = {
  getDashboard: () => api.get('/advertiser/dashboard'),
  getBilling: () => api.get('/advertiser/billing'),
  exportData: () => api.post('/advertiser/export-data'),
  deleteAccount: (data: {
    confirmation: 'DELETE_MY_ACCOUNT';
    currentPassword?: string;
    googleIdToken?: string;
  }) => api.post('/advertiser/delete-account', data),
  createCampaign: (data: Record<string, unknown>) =>
    api.post('/advertiser/campaigns', data).then((r) => ok(CreateCampaignResponse.parse(r.data))),
  updateCampaign: (id: string, data: Record<string, unknown>) =>
    api.patch(`/advertiser/campaigns/${id}`, data),
  submitCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/submit`),
  resetCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/reset`),
  pauseCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/pause`),
  resumeCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/resume`),
  archiveCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/archive`),
  listCampaigns: (params?: { page?: number; limit?: number; status?: string }) =>
    api.get('/advertiser/campaigns', { params }),
  getCampaign: (id: string) => api.get(`/advertiser/campaigns/${id}`),
  getReports: (params?: Record<string, unknown>) => api.get('/advertiser/reports', { params }),
  createDepositSession: (amountMinor: bigint | number, currency?: string) =>
    api.post('/advertiser/deposit-session', { amountMinor: Number(amountMinor), currency }),
};

export const adminApi = {
  getOverview: () => api.get('/admin/overview'),
  getUsers: (params?: Record<string, unknown>) => api.get('/admin/users', { params }),
  setUserStatus: (id: string, status: string) => api.post(`/admin/users/${id}/status`, { status }),
  eraseUser: (id: string) => api.post(`/admin/users/${id}/erase`),
  getPendingCampaigns: (params?: Record<string, unknown>) =>
    api.get('/admin/campaigns/pending', { params }),
  approveCampaign: (id: string, reason?: string) =>
    api.post(`/admin/campaigns/${id}/approve`, { reason }),
  rejectCampaign: (id: string, reason: string) =>
    api.post(`/admin/campaigns/${id}/reject`, { reason }),
  getPendingPayouts: () => api.get('/admin/payouts/pending'),
  approvePayout: (id: string, note?: string, approvedAmountMinor?: bigint | number) =>
    api.post(`/admin/payouts/${id}/approve`, {
      note,
      ...(approvedAmountMinor !== undefined
        ? { approvedAmountMinor: Number(approvedAmountMinor) }
        : {}),
    }),
  rejectPayout: (id: string, reason: string) => api.post(`/admin/payouts/${id}/reject`, { reason }),
  processPayout: (id: string) => api.post(`/admin/payouts/${id}/process`),
  markPayoutPaid: (
    id: string,
    data: { providerTxId: string; paidAt: string; amountMinor: bigint | number; currency: string },
  ) =>
    api.post(`/admin/payouts/${id}/mark-paid`, { ...data, amountMinor: Number(data.amountMinor) }),
  getMoneyIntegrity: () => api.get('/admin/money-integrity'),
  getFraudFlags: (params?: Record<string, unknown>) => api.get('/admin/fraud', { params }),
  getFraudStats: () => api.get('/admin/fraud/stats'),
  resolveFraudFlag: (id: string, decision: 'confirmed' | 'invalid', note?: string) =>
    api.post(`/admin/fraud/${id}/resolve`, { decision, note }),
  getRecoveryDebtCases: (params?: Record<string, unknown>) =>
    api.get('/admin/recovery-debt', { params }),
  openRecoveryDebtCase: (
    userId: string,
    data: {
      status?: 'open' | 'in_collections';
      currency?: string;
      externalReference?: string;
      note?: string;
    },
  ) => api.post(`/admin/recovery-debt/users/${userId}/open`, data),
  resolveRecoveryDebtCase: (
    id: string,
    data: {
      status: 'recovered' | 'written_off' | 'closed';
      externalReference?: string;
      note?: string;
    },
  ) => api.post(`/admin/recovery-debt/cases/${id}/resolve`, data),
  recomputeTrustScore: (userId: string) => api.post(`/admin/fraud/compute-trust/${userId}`),
  getAuditLog: (params?: Record<string, unknown>) => api.get('/admin/audit-log', { params }),
  getMetrics: (days?: number, currency?: string) => {
    const params: Record<string, string | number> = {};
    if (days !== undefined) params.days = days;
    if (currency) params.currency = currency;
    return api.get('/admin/metrics', { params });
  },
  getToolIntegrations: () => api.get('/admin/tools'),
  toggleToolIntegration: (slug: string, isActive: boolean) =>
    api.post(`/admin/tools/${slug}/toggle`, { isActive: String(isActive) }),
  getWebhookEvents: (params?: Record<string, unknown>) => api.get('/admin/webhooks', { params }),
  getPendingArchiveRefunds: (params?: { page?: number; limit?: number }) =>
    api.get('/admin/refunds/archive/pending', { params }),
  confirmArchiveRefund: (id: string, stripeRefundPaymentIntentId: string) =>
    api.post(`/admin/refunds/archive/${id}/confirm`, { stripeRefundPaymentIntentId }),
  getDevices: (params?: Record<string, unknown>) => api.get('/admin/devices', { params }),
  issueDeviceRecoveryToken: (
    deviceId: string,
    data: { userId: string; reason: string; expiresInMinutes?: number },
  ) => api.post(`/admin/devices/${deviceId}/recovery-token`, data),
  verifyPayoutAccount: (id: string, verified: boolean, reason?: string) =>
    api.post(`/admin/payout-accounts/${id}/verify`, { verified, reason }),
};

export const payoutApi = {
  addMethod: (data: Record<string, unknown>) =>
    api.post('/payout/method', data).then((r) => ok(PayoutMethodResponse.parse(r.data))),
  getInfo: () => api.get('/payout/info'),
  requestPayout: (data: Record<string, unknown>) =>
    api.post('/payout/request', data).then((r) => ok(PayoutRequestResponse.parse(r.data))),
  getHistory: (params?: Record<string, unknown>) => api.get('/payout/history', { params }),
  getAvailable: () =>
    api.get('/payout/available').then((r) => ok(PayoutAvailableResponse.parse(r.data))),
};

export const ledgerApi = {
  getBalance: () => api.get('/ledger/balance').then((r) => ok(LedgerBalanceResponse.parse(r.data))),
  getBreakdown: () => api.get('/ledger/breakdown'),
  getHistory: (params?: Record<string, unknown>) => api.get('/ledger/history', { params }),
  getAdminBreakdown: () => api.get('/ledger/admin/breakdown'),
  getAdminHistory: (params?: Record<string, unknown>) =>
    api.get('/ledger/admin/history', { params }),
};

export const referralApi = {
  getInfo: () => api.get('/referral'),
  applyCode: (code: string) => api.post('/referral/apply', { code }),
  getHistory: () => api.get('/referral/history'),
};

export const campaignApi = {
  getStats: (id: string) => api.get(`/campaigns/${id}/stats`),
  getCreatives: (id: string) =>
    api.get(`/campaigns/${id}/creatives`).then((r) => ok(CreativeResponse.array().parse(r.data))),
  createCreative: (id: string, data: Record<string, unknown>) =>
    api.post(`/campaigns/${id}/creatives`, data).then((r) => ok(CreativeResponse.parse(r.data))),
  setCountryTargeting: (id: string, data: { countryCode: string; include: boolean }[]) =>
    api.post(`/campaigns/${id}/targeting/countries`, data),
  approveCreative: (creativeId: string) => api.post(`/campaigns/creatives/${creativeId}/approve`),
  rejectCreative: (creativeId: string, reason: string) =>
    api.post(`/campaigns/creatives/${creativeId}/reject`, { reason }),
  updateCreative: (
    creativeId: string,
    data: {
      title?: string;
      sponsoredMessage?: string;
      destinationUrl?: string;
      displayDomain?: string;
      ctaText?: string | null;
    },
  ) => api.patch(`/campaigns/creatives/${creativeId}`, data),
};

export const systemApi = {
  getHealth: () => api.get('/health'),
};

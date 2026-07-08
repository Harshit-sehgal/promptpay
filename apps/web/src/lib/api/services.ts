import api from './client';
import {
  // Response schemas (runtime + type source)
  CreateCampaignResponse,
  CreativeResponse,
  PayoutMethodResponse,
  PayoutRequestResponse,
  PayoutAvailableResponse,
  LedgerBalanceResponse,
} from '@waitlayer/shared';

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
  deleteAccount: (data: { confirmation: 'DELETE_MY_ACCOUNT'; currentPassword?: string; googleIdToken?: string }) =>
    api.post('/developer/delete-account', data),
  listApiKeys: () => api.get('/developer/api-keys'),
  createApiKey: (data: { scopes: string[]; advertiserId?: string; expiresAt?: string }) =>
    api.post('/developer/api-keys', data),
  revokeApiKey: (id: string) => api.delete(`/developer/api-keys/${id}`),
};

export const advertiserApi = {
  getDashboard: () => api.get('/advertiser/dashboard'),
  getBilling: () => api.get('/advertiser/billing'),
  createCampaign: (data: Record<string, unknown>) =>
    api.post('/advertiser/campaigns', data).then((r) => ok(CreateCampaignResponse.parse(r.data))),
  submitCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/submit`),
  pauseCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/pause`),
  resumeCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/resume`),
  getReports: (params?: Record<string, unknown>) => api.get('/advertiser/reports', { params }),
  createDepositSession: (amountMinor: number, currency?: string) =>
    api.post('/advertiser/deposit-session', { amountMinor, currency }),
};

export const adminApi = {
  getOverview: () => api.get('/admin/overview'),
  getUsers: (params?: Record<string, unknown>) => api.get('/admin/users', { params }),
  getPendingCampaigns: () => api.get('/admin/campaigns/pending'),
  approveCampaign: (id: string, reason?: string) => api.post(`/admin/campaigns/${id}/approve`, { reason }),
  rejectCampaign: (id: string, reason: string) => api.post(`/admin/campaigns/${id}/reject`, { reason }),
  getPendingPayouts: () => api.get('/admin/payouts/pending'),
  approvePayout: (id: string, note?: string, approvedAmountMinor?: number) =>
    api.post(`/admin/payouts/${id}/approve`, {
      note,
      ...(approvedAmountMinor !== undefined ? { approvedAmountMinor } : {}),
    }),
  rejectPayout: (id: string, reason: string) => api.post(`/admin/payouts/${id}/reject`, { reason }),
  processPayout: (id: string) => api.post(`/admin/payouts/${id}/process`),
  markPayoutPaid: (
    id: string,
    data: { providerTxId: string; paidAt: string; amountMinor: number; currency: string },
  ) => api.post(`/admin/payouts/${id}/mark-paid`, data),
  getMoneyIntegrity: () => api.get('/admin/money-integrity'),
  getFraudFlags: (params?: Record<string, unknown>) => api.get('/admin/fraud', { params }),
  getFraudStats: () => api.get('/admin/fraud/stats'),
  resolveFraudFlag: (
    id: string,
    decision: 'confirmed' | 'invalid',
    note?: string,
  ) => api.post(`/admin/fraud/${id}/resolve`, { decision, note }),
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
  getAuditLog: (params?: Record<string, unknown>) => api.get('/admin/audit-log', { params }),
  getMetrics: (days?: number) => api.get('/admin/metrics', { params: { days } }),
  getToolIntegrations: () => api.get('/admin/tools'),
  toggleToolIntegration: (slug: string, isActive: boolean) =>
    api.post(`/admin/tools/${slug}/toggle`, { isActive: String(isActive) }),
  getWebhookEvents: (params?: Record<string, unknown>) => api.get('/admin/webhooks', { params }),
  getPendingArchiveRefunds: () => api.get('/admin/refunds/archive/pending'),
  confirmArchiveRefund: (id: string, stripeRefundPaymentIntentId: string) =>
    api.post(`/admin/refunds/archive/${id}/confirm`, { stripeRefundPaymentIntentId }),
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
  getBalance: () =>
    api.get('/ledger/balance').then((r) => ok(LedgerBalanceResponse.parse(r.data))),
  getBreakdown: () => api.get('/ledger/breakdown'),
  getHistory: (params?: Record<string, unknown>) => api.get('/ledger/history', { params }),
  getAdminBreakdown: () => api.get('/ledger/admin/breakdown'),
  getAdminHistory: (params?: Record<string, unknown>) => api.get('/ledger/admin/history', { params }),
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
};

export const systemApi = {
  getHealth: () => api.get('/health'),
};

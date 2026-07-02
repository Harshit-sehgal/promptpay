import api from './client';

type ApiPayload = object;
type QueryParams = object;

export const authApi = {
  signup: (data: ApiPayload) => api.post('/auth/signup', data),
  login: (data: ApiPayload) => api.post('/auth/login', data),
  googleLogin: (data: { idToken: string; role?: string }) => api.post('/auth/google', data),
  refresh: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  forgotPassword: (email: string) => api.post('/auth/password/forgot', { email }),
  resetPassword: (token: string, newPassword: string) => api.post('/auth/password/reset', { token, newPassword }),
  confirmEmailVerification: (token: string) => api.post('/auth/verify-email/confirm', { token }),
};

export const developerApi = {
  getDashboard: () => api.get('/developer/dashboard'),
  getEarnings: (params?: QueryParams) => api.get('/developer/earnings', { params }),
  getSettings: () => api.get('/developer/settings'),
  getTrust: () => api.get('/developer/trust'),
  updateSettings: (data: ApiPayload) => api.patch('/developer/settings', data),
  exportData: () => api.post('/developer/export-data'),
  listApiKeys: () => api.get('/developer/api-keys'),
  createApiKey: (data: { scopes: string[]; advertiserId?: string; expiresAt?: string }) => api.post('/developer/api-keys', data),
  revokeApiKey: (id: string) => api.delete(`/developer/api-keys/${id}`),
};

export const advertiserApi = {
  getDashboard: () => api.get('/advertiser/dashboard'),
  createCampaign: (data: ApiPayload) => api.post('/advertiser/campaigns', data),
  submitCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/submit`),
  pauseCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/pause`),
  resumeCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/resume`),
  getReports: (params?: QueryParams) => api.get('/advertiser/reports', { params }),
};

export const adminApi = {
  getOverview: () => api.get('/admin/overview'),
  getUsers: (params?: QueryParams) => api.get('/admin/users', { params }),
  getPendingCampaigns: () => api.get('/admin/campaigns/pending'),
  approveCampaign: (id: string, reason?: string) => api.post(`/admin/campaigns/${id}/approve`, { reason }),
  rejectCampaign: (id: string, reason: string) => api.post(`/admin/campaigns/${id}/reject`, { reason }),
  getPendingPayouts: () => api.get('/admin/payouts/pending'),
  approvePayout: (id: string, note?: string) => api.post(`/admin/payouts/${id}/approve`, { note }),
  rejectPayout: (id: string, reason: string) => api.post(`/admin/payouts/${id}/reject`, { reason }),
  getFraudFlags: (params?: QueryParams) => api.get('/admin/fraud', { params }),
  resolveFraudFlag: (id: string, decision: 'confirmed' | 'invalid', note?: string) => api.post(`/admin/fraud/${id}/resolve`, { decision, note }),
  getAuditLog: (params?: QueryParams) => api.get('/admin/audit-log', { params }),
};

export const payoutApi = {
  addMethod: (data: ApiPayload) => api.post('/payout/method', data),
  getInfo: () => api.get('/payout/info'),
  requestPayout: (data: ApiPayload) => api.post('/payout/request', data),
  getHistory: (params?: QueryParams) => api.get('/payout/history', { params }),
};

export const ledgerApi = {
  getBalance: () => api.get('/ledger/balance'),
  getBreakdown: () => api.get('/ledger/breakdown'),
  getHistory: (params?: QueryParams) => api.get('/ledger/history', { params }),
  getAdminBreakdown: () => api.get('/ledger/admin/breakdown'),
  getAdminHistory: (params?: QueryParams) => api.get('/ledger/admin/history', { params }),
};

export const referralApi = {
  getInfo: () => api.get('/referral'),
  applyCode: (code: string) => api.post('/referral/apply', { code }),
  getHistory: () => api.get('/referral/history'),
};

export const campaignApi = {
  getStats: (id: string) => api.get(`/campaigns/${id}/stats`),
  getCreatives: (id: string) => api.get(`/campaigns/${id}/creatives`),
  createCreative: (id: string, data: ApiPayload) => api.post(`/campaigns/${id}/creatives`, data),
  setCountryTargeting: (id: string, data: ApiPayload) => api.post(`/campaigns/${id}/targeting/countries`, data),
  approveCreative: (creativeId: string) => api.post(`/campaigns/creatives/${creativeId}/approve`),
  rejectCreative: (creativeId: string, reason: string) => api.post(`/campaigns/creatives/${creativeId}/reject`, { reason }),
};

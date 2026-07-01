import api from './client';

export const authApi = {
  signup: (data: any) => api.post('/auth/signup', data),
  login: (data: any) => api.post('/auth/login', data),
  refresh: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
};

export const developerApi = {
  getDashboard: () => api.get('/developer/dashboard'),
  getEarnings: (params?: any) => api.get('/developer/earnings', { params }),
  getSettings: () => api.get('/developer/settings'),
  updateSettings: (data: any) => api.patch('/developer/settings', data),
  exportData: () => api.post('/developer/export-data'),
};

export const advertiserApi = {
  getDashboard: () => api.get('/advertiser/dashboard'),
  createCampaign: (data: any) => api.post('/advertiser/campaigns', data),
  submitCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/submit`),
  pauseCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/pause`),
  resumeCampaign: (id: string) => api.post(`/advertiser/campaigns/${id}/resume`),
  getReports: (params?: any) => api.get('/advertiser/reports', { params }),
};

export const adminApi = {
  getOverview: () => api.get('/admin/overview'),
  getUsers: (params?: any) => api.get('/admin/users', { params }),
  getPendingCampaigns: () => api.get('/admin/campaigns/pending'),
  approveCampaign: (id: string, reason?: string) => api.post(`/admin/campaigns/${id}/approve`, { reason }),
  rejectCampaign: (id: string, reason: string) => api.post(`/admin/campaigns/${id}/reject`, { reason }),
  getPendingPayouts: () => api.get('/admin/payouts/pending'),
  approvePayout: (id: string, note?: string) => api.post(`/admin/payouts/${id}/approve`, { note }),
  rejectPayout: (id: string, reason: string) => api.post(`/admin/payouts/${id}/reject`, { reason }),
  getFraudFlags: (params?: any) => api.get('/admin/fraud/flags', { params }),
  resolveFraudFlag: (id: string, isValid: boolean, note?: string) => api.post(`/admin/fraud/flags/${id}/resolve`, { isValid, note }),
};

export const payoutApi = {
  addMethod: (data: any) => api.post('/payout/method', data),
  getInfo: () => api.get('/payout/info'),
  requestPayout: (data: any) => api.post('/payout/request', data),
  getHistory: (params?: any) => api.get('/payout/history', { params }),
};

export const ledgerApi = {
  getBalance: () => api.get('/ledger/balance'),
  getBreakdown: () => api.get('/ledger/breakdown'),
  getHistory: (params?: any) => api.get('/ledger/history', { params }),
};

export const campaignApi = {
  getStats: (id: string) => api.get(`/campaigns/${id}/stats`),
  getCreatives: (id: string) => api.get(`/campaigns/${id}/creatives`),
  createCreative: (id: string, data: any) => api.post(`/campaigns/${id}/creatives`, data),
  setCountryTargeting: (id: string, data: any) => api.post(`/campaigns/${id}/targeting/countries`, data),
};

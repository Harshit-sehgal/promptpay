import { beforeEach,describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import { adminApi } from '@/lib/api/services';

vi.mock('@/lib/api/client', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

describe('adminApi.recomputeTrustScore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the compute-trust endpoint for the user', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });
    await adminApi.recomputeTrustScore('user-123');
    expect(api.post).toHaveBeenCalledWith('/admin/fraud/compute-trust/user-123');
  });

  it('rejects when the request fails (e.g. HTTP 500) so the UI can show an error', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Request failed with status code 500'),
    );
    await expect(adminApi.recomputeTrustScore('user-123')).rejects.toThrow();
  });
});

describe('adminApi.getDevices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the admin device lookup endpoint with query params', async () => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { devices: [], total: 0 } });

    await adminApi.getDevices({ search: 'dev@example.com', limit: 25 });

    expect(api.get).toHaveBeenCalledWith('/admin/devices', {
      params: { search: 'dev@example.com', limit: 25 },
    });
  });
});

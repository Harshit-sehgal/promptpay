import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api/client';
import { DEVELOPER_LEDGER_API_KEY_SCOPES, developerApi } from '@/lib/api/services';

vi.mock('@/lib/api/client', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

describe('developer API key helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the settings-page key as ledger read-only', async () => {
    (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

    await developerApi.createLedgerApiKey();

    expect(DEVELOPER_LEDGER_API_KEY_SCOPES).toEqual(['ledger:read']);
    expect(api.post).toHaveBeenCalledWith('/developer/api-keys', {
      scopes: ['ledger:read'],
    });
  });
});

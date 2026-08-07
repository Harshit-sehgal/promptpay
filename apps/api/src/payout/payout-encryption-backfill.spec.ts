import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillLegacyPayoutDestinations } from '../../../../scripts/encrypt-legacy-payout-destinations';
import {
  decryptPayoutDestination,
  encryptPayoutDestination,
  hmacPayoutDestination,
} from '../common/utils/payout-encryption';

const TEST_KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex',
).toString('base64');

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PAYOUT_ENCRYPTION_KEY: process.env.PAYOUT_ENCRYPTION_KEY,
  PAYOUT_HMAC_KEY: process.env.PAYOUT_HMAC_KEY,
};

interface StoredRow {
  id: string;
  userId: string;
  provider: string;
  destination: string;
  currency: string;
  userStatus: string;
  destinationHmac: string | null;
  encryptionMigratedAt: Date | null;
}

function restoreEnv(name: keyof typeof originalEnv): void {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function makeStore(rows: StoredRow[]) {
  const eligible = (row: StoredRow) =>
    row.userStatus !== 'deleted' &&
    !row.destination.startsWith('v1:') &&
    !row.destination.startsWith('v2:');

  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
    const row = rows.find((candidate) => candidate.id === where.id);
    if (!row) throw new Error(`missing payout account ${where.id}`);
    Object.assign(row, data);
    return row;
  });
  const tx = {
    payoutAccount: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ? { ...row } : null;
      }),
      update,
    },
  };
  const store = {
    payoutAccount: {
      count: vi.fn(async () => rows.filter(eligible).length),
      findMany: vi.fn(async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
        const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
        const cursorIndex = cursor
          ? sorted.findIndex((candidate) => candidate.id === cursor.id) + 1
          : 0;
        return sorted
          .slice(cursorIndex)
          .filter(eligible)
          .slice(0, take)
          .map((row) => ({ ...row }));
      }),
    },
    $transaction: vi.fn(async <T>(callback: (client: typeof tx) => Promise<T>): Promise<T> =>
      callback(tx),
    ),
  };
  return { store, update };
}

describe('legacy payout-destination backfill', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PAYOUT_ENCRYPTION_KEY = TEST_KEY;
    process.env.PAYOUT_HMAC_KEY = TEST_KEY;
  });

  afterEach(() => {
    restoreEnv('NODE_ENV');
    restoreEnv('PAYOUT_ENCRYPTION_KEY');
    restoreEnv('PAYOUT_HMAC_KEY');
  });

  it('leaves v1/v2 ciphertext and erased-user tombstones untouched, and binds plaintext as v2', async () => {
    const v2Binding = {
      accountId: 'pa-v2',
      userId: 'user-v2',
      provider: 'stripe_connect',
      currency: 'USD',
    };
    const existingV2 = encryptPayoutDestination('acct_existing', v2Binding);
    const existingV1 = encryptPayoutDestination('legacy@example.com');
    const rows: StoredRow[] = [
      {
        id: 'pa-plain',
        userId: 'user-plain',
        provider: 'paypal_email',
        destination: 'developer@example.com',
        currency: 'USD',
        userStatus: 'active',
        destinationHmac: null,
        encryptionMigratedAt: null,
      },
      {
        id: 'pa-v1',
        userId: 'user-v1',
        provider: 'paypal_email',
        destination: existingV1,
        currency: 'USD',
        userStatus: 'active',
        destinationHmac: hmacPayoutDestination('legacy@example.com'),
        encryptionMigratedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        ...v2Binding,
        id: v2Binding.accountId,
        destination: existingV2,
        userStatus: 'active',
        destinationHmac: hmacPayoutDestination('acct_existing'),
        encryptionMigratedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pa-deleted',
        userId: 'user-deleted',
        provider: 'manual',
        destination: 'deleted-pa-deleted',
        currency: 'USD',
        userStatus: 'deleted',
        destinationHmac: null,
        encryptionMigratedAt: null,
      },
    ];
    const { store, update } = makeStore(rows);

    await expect(
      backfillLegacyPayoutDestinations(store, {
        batchSize: 10,
        maxIterations: 10,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }),
    ).resolves.toEqual({ processed: 1, remaining: 0 });

    expect(store.payoutAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { destination: { not: { startsWith: 'v1:' } } },
            { destination: { not: { startsWith: 'v2:' } } },
          ],
          user: { status: { not: 'deleted' } },
        },
      }),
    );
    expect(update).toHaveBeenCalledTimes(1);
    const plaintext = rows.find((row) => row.id === 'pa-plain');
    expect(plaintext?.destination).toMatch(/^v2:/);
    expect(plaintext?.destinationHmac).toBe(hmacPayoutDestination('developer@example.com'));
    expect(plaintext?.encryptionMigratedAt).toBeInstanceOf(Date);

    const plaintextBinding = {
      accountId: 'pa-plain',
      userId: 'user-plain',
      provider: 'paypal_email',
      currency: 'USD',
    };
    expect(decryptPayoutDestination(plaintext!.destination, plaintextBinding)).toBe(
      'developer@example.com',
    );
    expect(() =>
      decryptPayoutDestination(plaintext!.destination, {
        ...plaintextBinding,
        accountId: 'different-account',
      }),
    ).toThrow();

    expect(rows.find((row) => row.id === 'pa-v1')?.destination).toBe(existingV1);
    expect(rows.find((row) => row.id === 'pa-v2')?.destination).toBe(existingV2);
    expect(rows.find((row) => row.id === 'pa-deleted')?.destination).toBe('deleted-pa-deleted');
  });

  it('rejects a non-canonical production key before reading any rows', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYOUT_ENCRYPTION_KEY = TEST_KEY.slice(0, -1);
    const { store } = makeStore([]);

    await expect(backfillLegacyPayoutDestinations(store)).rejects.toThrow(/PAYOUT_ENCRYPTION_KEY/);
    expect(store.payoutAccount.count).not.toHaveBeenCalled();
  });
});

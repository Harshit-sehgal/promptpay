import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateDepositSessionDto } from './advertiser.dto';

describe('CreateDepositSessionDto currency policy contract', () => {
  it('accepts JPY from the shared currency policy', async () => {
    const dto = plainToInstance(CreateDepositSessionDto, {
      amountMinor: '100',
      currency: 'jpy',
    });
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.amountMinor).toBe(100n);
  });

  it.each(['mxn', 'sgd'])(
    'rejects %s because it is absent from shared policy',
    async (currency) => {
      const dto = plainToInstance(CreateDepositSessionDto, {
        amountMinor: '100',
        currency,
      });
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'currency')).toBe(true);
    },
  );

  it('leaves malformed money for IsBigInt to reject without throwing', async () => {
    const dto = plainToInstance(CreateDepositSessionDto, {
      amountMinor: '12.34',
      currency: 'usd',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'amountMinor')).toBe(true);
  });
});

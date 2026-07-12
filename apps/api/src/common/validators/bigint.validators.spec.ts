import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateCampaignDto } from '../../advertiser/dto/advertiser.dto';

describe('BigInt validators', () => {
  it('accepts valid bigint monetary values', async () => {
    const dto = plainToInstance(CreateCampaignDto, {
      name: 'Test',
      category: 'developer-tools',
      bidType: 'cpc',
      currency: 'USD',
      bidAmountMinor: 100n,
      budgetTotalMinor: 1000n,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects non-bigint monetary values', async () => {
    const dto = Object.assign(new CreateCampaignDto(), {
      name: 'Test',
      category: 'developer-tools',
      bidType: 'cpc',
      currency: 'USD',
      bidAmountMinor: 'not-bigint',
      budgetTotalMinor: null,
    });
    const errors = await validate(dto);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('bidAmountMinor');
    expect(properties).toContain('budgetTotalMinor');
  });

  it('rejects values below the minimum', async () => {
    const dto = plainToInstance(CreateCampaignDto, {
      name: 'Test',
      category: 'developer-tools',
      bidType: 'cpc',
      currency: 'USD',
      bidAmountMinor: 0n,
      budgetTotalMinor: 0n,
    });
    const errors = await validate(dto);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('bidAmountMinor');
    expect(properties).toContain('budgetTotalMinor');
  });

  it('rejects negative bigint values', async () => {
    const dto = plainToInstance(CreateCampaignDto, {
      name: 'Test',
      category: 'developer-tools',
      bidType: 'cpc',
      currency: 'USD',
      bidAmountMinor: -100n,
      budgetTotalMinor: -1000n,
    });
    const errors = await validate(dto);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('bidAmountMinor');
    expect(properties).toContain('budgetTotalMinor');
  });

  it('accepts values equal to the minimum', async () => {
    const dto = plainToInstance(CreateCampaignDto, {
      name: 'Test',
      category: 'developer-tools',
      bidType: 'cpc',
      currency: 'USD',
      bidAmountMinor: 1n,
      budgetTotalMinor: 1n,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

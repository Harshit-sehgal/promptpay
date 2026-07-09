import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { UpdateSettingsDto } from './developer.dto';

// A-057: boundary validation for per-developer blocked category slugs so a
// typo'd or free-text preference cannot be persisted as a blocking rule that
// would never match a real campaign category.
async function validateDto(data: Partial<UpdateSettingsDto>) {
  const dto = new UpdateSettingsDto();
  Object.assign(dto, data);
  return validate(dto);
}

function fieldErrors(errors: Awaited<ReturnType<typeof validateDto>>, field: string) {
  return errors
    .filter((e) => e.property === field)
    .flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('UpdateSettingsDto.blockedCategories (A-057)', () => {
  it('accepts valid lowercase slug entries', async () => {
    const errors = await validateDto({ blockedCategories: ['finance', 'developer-tools'] });
    expect(errors).toHaveLength(0);
  });

  it('is optional and accepts an omitted field', async () => {
    const errors = await validateDto({ adsEnabled: true });
    expect(errors).toHaveLength(0);
  });

  it('rejects free-text / spaced entries (typo guard)', async () => {
    const errors = await validateDto({ blockedCategories: ['Finance!', 'bad category'] });
    expect(fieldErrors(errors, 'blockedCategories').length).toBeGreaterThan(0);
  });

  it('rejects uppercase entries', async () => {
    const errors = await validateDto({ blockedCategories: ['GAMBLING'] });
    expect(fieldErrors(errors, 'blockedCategories').length).toBeGreaterThan(0);
  });

  it('rejects empty-string entries', async () => {
    const errors = await validateDto({ blockedCategories: [''] });
    expect(fieldErrors(errors, 'blockedCategories').length).toBeGreaterThan(0);
  });
});

import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ToolType } from '@waitlayer/shared';

import { AdRequestDto } from './ad-events.dto';

function baseValid(): AdRequestDto {
  const d = new AdRequestDto();
  d.deviceId = '123e4567-e89b-12d3-a456-426614174000';
  d.sessionId = 'sess-1';
  d.waitStateId = 'wait-1';
  d.toolType = ToolType.VSCODE;
  d.idempotencyKey = 'idem-1';
  d.signature = 'valid-hmac-signature';
  return d;
}

describe('AdRequestDto category slug validation (A-057)', () => {
  it('accepts valid lowercase slug category arrays', async () => {
    const dto = baseValid();
    dto.allowedCategories = ['finance', 'web3', 'ai-tools'];
    dto.blockedCategories = ['gambling', 'crypto-news'];
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects non-slug entries in allowed/blocked category arrays', async () => {
    const badValues: Array<[keyof AdRequestDto, string[]]> = [
      ['allowedCategories', ['Finance!']],
      ['allowedCategories', ['UPPER']],
      ['allowedCategories', ['has space']],
      ['blockedCategories', ['']],
      ['blockedCategories', ['UPPER']],
    ];
    for (const [field, value] of badValues) {
      const dto = baseValid();
      (dto as Record<string, unknown>)[field] = value;
      const errors = await validate(dto);
      expect(errors.length, `${field}=${JSON.stringify(value)}`).toBeGreaterThan(0);
    }
  });
});

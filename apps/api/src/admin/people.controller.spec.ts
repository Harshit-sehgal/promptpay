import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { PeopleController } from './people.controller';
import type { PeopleService } from './people.service';

function makeController() {
  const service = {
    listUsers: vi.fn().mockResolvedValue({ rows: [] }),
    listWaitlist: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return { controller: new PeopleController(service as unknown as PeopleService), service };
}

describe('PeopleController query params', () => {
  it('rejects a repeated key with 400 instead of crashing on an array', () => {
    const { controller, service } = makeController();
    expect(() => controller.listUsers(['a', 'b'])).toThrow(BadRequestException);
    expect(() => controller.listWaitlist(undefined, undefined, undefined, ['1', '2'])).toThrow(
      BadRequestException,
    );
    expect(service.listUsers).not.toHaveBeenCalled();
  });

  it('passes single values through and parses pagination', () => {
    const { controller, service } = makeController();
    controller.listWaitlist('acme', 'pending', 'us', '2', '50');
    expect(service.listWaitlist).toHaveBeenCalledWith(
      { search: 'acme', status: 'pending', country: 'us' },
      { page: 2, limit: 50 },
    );
  });
});

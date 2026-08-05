import { describe, expect, it, vi } from 'vitest';

import { EnvironmentMarkerService } from './environment-marker.service';

function makeService(
  marker: Record<string, unknown> | null = null,
  environmentKind = 'sandbox',
  environmentId = 'run-1',
) {
  const prisma = {
    environmentMarker: {
      findUnique: vi.fn().mockResolvedValue(marker),
      create: vi.fn().mockResolvedValue({
        id: 1,
        environmentKind,
        environmentId,
      }),
    },
  };
  const config = {
    get: vi.fn((key: string, fallback: string) => {
      if (key === 'WAITLAYER_ENVIRONMENT_KIND') return environmentKind;
      if (key === 'WAITLAYER_ENVIRONMENT_ID') return environmentId;
      return fallback;
    }),
  };
  return {
    service: new EnvironmentMarkerService(prisma as never, config as never),
    prisma,
  };
}

describe('EnvironmentMarkerService', () => {
  it('initializes a missing marker for a non-production environment', async () => {
    const { service, prisma } = makeService();

    await expect(service.verify()).resolves.toBeUndefined();

    expect(prisma.environmentMarker.create).toHaveBeenCalledWith({
      data: {
        id: 1,
        environmentKind: 'sandbox',
        environmentId: 'run-1',
      },
    });
  });

  it('fails closed when a production database has no marker', async () => {
    const { service, prisma } = makeService(null, 'production', 'prod-1');

    await expect(service.verify()).rejects.toThrow(
      'Database environment marker is missing for production environment production/prod-1',
    );
    expect(prisma.environmentMarker.create).not.toHaveBeenCalled();
  });

  it('rejects a database marker from another environment or run', async () => {
    const { service } = makeService({
      id: 1,
      environmentKind: 'sandbox',
      environmentId: 'different-run',
    });

    await expect(service.verify()).rejects.toThrow(
      'Database environment marker sandbox/different-run does not match API sandbox/run-1',
    );
  });

  it('accepts an exact marker match without rewriting it', async () => {
    const { service, prisma } = makeService({
      id: 1,
      environmentKind: 'sandbox',
      environmentId: 'run-1',
    });

    await expect(service.verify()).resolves.toBeUndefined();
    expect(prisma.environmentMarker.create).not.toHaveBeenCalled();
  });
});

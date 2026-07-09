import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { loadEnv } from '@waitlayer/config';

describe('Nest ConfigService wiring (A-017)', () => {
  beforeEach(() => {
    // Ensure unrelated real env does not leak into the isolated module.
    vi.stubEnv('WEB_BASE_URL', '');
  });

  it('returns the schema default for WEB_BASE_URL when not explicitly set', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          // Mirror AppModule: validated, defaulted env feeds ConfigService.
          load: [
            () =>
              loadEnv({
                NODE_ENV: 'test',
                DATABASE_URL: 'postgres://localhost:5432/test',
                JWT_SECRET: 'test-secret-at-least-32-characters-long-0000000000',
              } as NodeJS.ProcessEnv),
          ],
        }),
      ],
    }).compile();

    const config = moduleRef.get(ConfigService);
    // Explicit env absent → schema default applies.
    expect(config.get('WEB_BASE_URL')).toBe('http://localhost:3000');
    expect(config.get('API_PORT')).toBe(4002);
  });
});

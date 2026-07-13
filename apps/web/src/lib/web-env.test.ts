import { describe, expect, it } from 'vitest';

import { validateWebEnv } from './web-env';

describe('web environment validation', () => {
  it('requires a non-placeholder JWT secret in production', () => {
    expect(() => validateWebEnv({ NODE_ENV: 'production' })).toThrow('Invalid web environment');
    expect(() =>
      validateWebEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'dev-only-docker-compose-jwt-secret-at-least-32-char',
      }),
    ).toThrow('Invalid web environment');
  });

  it('accepts a strong production secret and server-only internal API URL', () => {
    expect(
      validateWebEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'production-random-secret-at-least-32-characters-long',
        API_INTERNAL_URL: 'http://api:4002/api/v1',
      }),
    ).toMatchObject({ NODE_ENV: 'production', API_INTERNAL_URL: 'http://api:4002/api/v1' });
  });

  it('remains permissive but fail-closed-at-middleware in development', () => {
    expect(validateWebEnv({ NODE_ENV: 'development' })).toMatchObject({
      NODE_ENV: 'development',
    });
  });

  it.each([
    { NEXT_PUBLIC_API_URL: 'http://api.example.com/api/v1' },
    { NEXT_PUBLIC_API_URL: 'https://user:pass@api.example.com/api/v1' },
    { NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1?token=leak' },
    { API_INTERNAL_URL: 'http://public.example.com/api/v1' },
  ])('rejects unsafe production credential endpoint %o', (endpoint) => {
    expect(() =>
      validateWebEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'production-random-secret-at-least-32-characters-long',
        ...endpoint,
      }),
    ).toThrow('Invalid web environment');
  });
});

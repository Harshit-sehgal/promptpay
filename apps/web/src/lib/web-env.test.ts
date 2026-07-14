import { describe, expect, it } from 'vitest';

import { validateWebEnv } from './web-env';

describe('web environment validation', () => {
  it('requires a non-placeholder JWT secret and public key in production', () => {
    expect(() => validateWebEnv({ NODE_ENV: 'production' })).toThrow('Invalid web environment');
    expect(() =>
      validateWebEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'dev-only-docker-compose-jwt-secret-at-least-32-char',
        JWT_PUBLIC_KEY:
          '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4mwTmn+U56X+qoCNYMdI\nBKKzBOdk80n4+3Uuy0xn7CuPMSH0sqVOWYpTI0TsN+IhOjkRmmjWCedIE0YWexnl\nkQyW6fpGIuoZdV+eM1pcc/9fdpYg+QXJR4/FHHnVqhdV/6pTv7LyUlX/DBi1wqJV\nRIzT9+t+t6CJYbxto6dKKbPd/RLlK7WOpYEYZyceqTkYmnRrykVJ/gzu5CvU+G9q\ni3bV9nKQHzKwygjeCB6GrGj01a2UC/cSeGUPk5u9CJZyt6xhOU5+vkp93lXd/miw\ngof3a82t/8tncdL9XsSThXyuQbeTTMVUQFo3UVAyPhyXVYwi7aZcOWxlJ4j0AJYj\nWwIDAQAB\n-----END PUBLIC KEY-----',
      }),
    ).toThrow('Invalid web environment');
  });

  it('accepts a strong production secret, public key and server-only internal API URL', () => {
    expect(
      validateWebEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'production-random-secret-at-least-32-characters-long',
        JWT_PUBLIC_KEY:
          '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4mwTmn+U56X+qoCNYMdI\nBKKzBOdk80n4+3Uuy0xn7CuPMSH0sqVOWYpTI0TsN+IhOjkRmmjWCedIE0YWexnl\nkQyW6fpGIuoZdV+eM1pcc/9fdpYg+QXJR4/FHHnVqhdV/6pTv7LyUlX/DBi1wqJV\nRIzT9+t+t6CJYbxto6dKKbPd/RLlK7WOpYEYZyceqTkYmnRrykVJ/gzu5CvU+G9q\ni3bV9nKQHzKwygjeCB6GrGj01a2UC/cSeGUPk5u9CJZyt6xhOU5+vkp93lXd/miw\ngof3a82t/8tncdL9XsSThXyuQbeTTMVUQFo3UVAyPhyXVYwi7aZcOWxlJ4j0AJYj\nWwIDAQAB\n-----END PUBLIC KEY-----',
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
        JWT_PUBLIC_KEY:
          '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4mwTmn+U56X+qoCNYMdI\nBKKzBOdk80n4+3Uuy0xn7CuPMSH0sqVOWYpTI0TsN+IhOjkRmmjWCedIE0YWexnl\nkQyW6fpGIuoZdV+eM1pcc/9fdpYg+QXJR4/FHHnVqhdV/6pTv7LyUlX/DBi1wqJV\nRIzT9+t+t6CJYbxto6dKKbPd/RLlK7WOpYEYZyceqTkYmnRrykVJ/gzu5CvU+G9q\ni3bV9nKQHzKwygjeCB6GrGj01a2UC/cSeGUPk5u9CJZyt6xhOU5+vkp93lXd/miw\ngof3a82t/8tncdL9XsSThXyuQbeTTMVUQFo3UVAyPhyXVYwi7aZcOWxlJ4j0AJYj\nWwIDAQAB\n-----END PUBLIC KEY-----',
        ...endpoint,
      }),
    ).toThrow('Invalid web environment');
  });
});

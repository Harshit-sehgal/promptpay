import { describe, expect, it } from 'vitest';

import { redactUrl } from './logging.interceptor';

describe('redactUrl', () => {
  it('redacts ordinary PII-bearing query values as well as explicit secrets', () => {
    const redacted = redactUrl(
      '/api/v1/admin/users?search=person%40example.com&token=secret-value&page=2',
    );

    expect(redacted).toContain('search=%5Bredacted%5D');
    expect(redacted).toContain('token=%5Bredacted%5D');
    expect(redacted).toContain('page=%5Bredacted%5D');
    expect(redacted).not.toContain('person%40example.com');
    expect(redacted).not.toContain('secret-value');
  });

  it('preserves the path and removes URL fragments', () => {
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
    expect(redactUrl('https://api.example.test/path?q=value#private')).toBe(
      'https://api.example.test/path?q=%5Bredacted%5D',
    );
  });

  it('fails closed for malformed URLs with a query string', () => {
    expect(redactUrl('http://[invalid?email=person@example.com')).toBe(
      'http://[invalid?[redacted]',
    );
  });
});

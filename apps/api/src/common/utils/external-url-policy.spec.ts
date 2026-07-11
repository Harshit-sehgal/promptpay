import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import {
  normalizeCreativeDestination,
  normalizeCreativeUpdate,
  normalizeOptionalPublicHttpsUrl,
  parsePublicHttpsUrl,
} from './external-url-policy';

describe('parsePublicHttpsUrl (A-057 / #4)', () => {
  it('accepts a valid public https URL and normalizes the hostname', () => {
    expect(parsePublicHttpsUrl('  https://Example.com/path?x=1  ', 'url')).toEqual({
      value: 'https://Example.com/path?x=1',
      hostname: 'example.com',
    });
  });

  it('rejects empty / undefined input', () => {
    expect(() => parsePublicHttpsUrl(undefined, 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('   ', 'url')).toThrow(BadRequestException);
  });

  it('rejects non-https schemes', () => {
    expect(() => parsePublicHttpsUrl('http://example.com', 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('ftp://example.com', 'url')).toThrow(BadRequestException);
  });

  it('rejects embedded credentials', () => {
    expect(() => parsePublicHttpsUrl('https://user:pass@example.com', 'url')).toThrow(
      BadRequestException,
    );
  });

  it('rejects IP addresses (SSRF guard)', () => {
    expect(() => parsePublicHttpsUrl('https://127.0.0.1', 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://192.168.1.1', 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://[::1]', 'url')).toThrow(BadRequestException);
  });

  it('rejects reserved / private hostnames', () => {
    expect(() => parsePublicHttpsUrl('https://localhost', 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://app.localhost', 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://host.internal', 'url')).toThrow(BadRequestException);
  });

  it('rejects single-label and numeric-TLD hostnames', () => {
    expect(() => parsePublicHttpsUrl('https://singlelabel', 'url')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://example.123', 'url')).toThrow(BadRequestException);
  });
});

describe('normalizeOptionalPublicHttpsUrl (A-057 / #4)', () => {
  it('returns undefined for undefined input', () => {
    expect(normalizeOptionalPublicHttpsUrl(undefined, 'url')).toBeUndefined();
  });
  it('returns the parsed value otherwise', () => {
    expect(normalizeOptionalPublicHttpsUrl('https://Example.com', 'url')).toBe(
      'https://Example.com',
    );
  });
});

describe('normalizeCreativeDestination (A-057 / #4)', () => {
  it('accepts a matching displayDomain (www stripped)', () => {
    expect(
      normalizeCreativeDestination({
        destinationUrl: 'https://example.com/ad',
        displayDomain: 'www.example.com',
      }),
    ).toEqual({ destinationUrl: 'https://example.com/ad', displayDomain: 'www.example.com' });
  });

  it('rejects a displayDomain that does not match the destination hostname', () => {
    expect(() =>
      normalizeCreativeDestination({
        destinationUrl: 'https://example.com/ad',
        displayDomain: 'evil.com',
      }),
    ).toThrow(BadRequestException);
  });
});

describe('normalizeCreativeUpdate (A-057 / #4)', () => {
  it('falls back to the existing destination hostname when only displayDomain changes', () => {
    expect(
      normalizeCreativeUpdate({ displayDomain: 'example.com' }, 'https://example.com/ad'),
    ).toEqual({
      displayDomain: 'example.com',
    });
  });

  it('rejects a mismatched displayDomain on partial update', () => {
    expect(() =>
      normalizeCreativeUpdate({ displayDomain: 'evil.com' }, 'https://example.com/ad'),
    ).toThrow(BadRequestException);
  });

  it('uses the new destination hostname when destinationUrl is provided', () => {
    expect(
      normalizeCreativeUpdate(
        { destinationUrl: 'https://new.com/ad', displayDomain: 'new.com' },
        'https://example.com/ad',
      ),
    ).toEqual({ destinationUrl: 'https://new.com/ad', displayDomain: 'new.com' });
  });
});

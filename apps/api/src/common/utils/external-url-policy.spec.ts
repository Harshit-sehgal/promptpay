import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import {
  normalizeCreativeDestination,
  normalizeCreativeUpdate,
  normalizeOptionalPublicHttpsUrl,
  parsePublicHttpsUrl,
} from './external-url-policy';

describe('external URL policy', () => {
  it('accepts public HTTPS URLs and matching display domains', () => {
    expect(
      normalizeCreativeDestination({
        destinationUrl: ' https://www.example.com/path ',
        displayDomain: 'Example.COM',
      }),
    ).toEqual({
      destinationUrl: 'https://www.example.com/path',
      displayDomain: 'example.com',
    });
  });

  it('rejects non-HTTPS URLs', () => {
    expect(() => parsePublicHttpsUrl('http://example.com', 'destinationUrl')).toThrow(BadRequestException);
  });

  it('rejects localhost and IP literal hosts', () => {
    expect(() => parsePublicHttpsUrl('https://localhost/callback', 'destinationUrl')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://127.0.0.1/callback', 'destinationUrl')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://[::1]/callback', 'destinationUrl')).toThrow(BadRequestException);
  });

  it('rejects credentialed URLs', () => {
    expect(() => parsePublicHttpsUrl('https://user:pass@example.com', 'destinationUrl')).toThrow(BadRequestException);
  });

  it('rejects internal-style hostnames', () => {
    expect(() => parsePublicHttpsUrl('https://billing.internal', 'destinationUrl')).toThrow(BadRequestException);
    expect(() => parsePublicHttpsUrl('https://intranet', 'destinationUrl')).toThrow(BadRequestException);
  });

  it('rejects deceptive display domains', () => {
    expect(() =>
      normalizeCreativeDestination({
        destinationUrl: 'https://evil.example.net/offer',
        displayDomain: 'trusted.example.com',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects display domains with schemes or paths', () => {
    expect(() =>
      normalizeCreativeDestination({
        destinationUrl: 'https://example.com/offer',
        displayDomain: 'https://example.com/offer',
      }),
    ).toThrow(BadRequestException);
  });

  it('derives a truthful display domain when an update changes only the destination URL', () => {
    expect(
      normalizeCreativeUpdate(
        { destinationUrl: 'https://new.example.com/product' },
        'https://old.example.com/product',
      ),
    ).toEqual({
      destinationUrl: 'https://new.example.com/product',
      displayDomain: 'new.example.com',
    });
  });

  it('validates display-domain-only updates against the existing destination URL', () => {
    expect(
      normalizeCreativeUpdate(
        { displayDomain: 'example.com' },
        'https://www.example.com/product',
      ),
    ).toEqual({ displayDomain: 'example.com' });

    expect(() =>
      normalizeCreativeUpdate(
        { displayDomain: 'other.example.com' },
        'https://www.example.com/product',
      ),
    ).toThrow(BadRequestException);
  });

  it('normalizes optional advertiser profile URLs with the same policy', () => {
    expect(normalizeOptionalPublicHttpsUrl(undefined, 'websiteUrl')).toBeUndefined();
    expect(normalizeOptionalPublicHttpsUrl(' https://example.com ', 'websiteUrl')).toBe('https://example.com');
    expect(() => normalizeOptionalPublicHttpsUrl('javascript:alert(1)', 'websiteUrl')).toThrow(BadRequestException);
  });
});

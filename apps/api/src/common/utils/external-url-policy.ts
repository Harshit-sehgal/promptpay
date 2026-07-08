import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';

export interface PublicHttpsUrl {
  value: string;
  hostname: string;
}

const RESERVED_HOSTNAMES = new Set(['localhost']);
const RESERVED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
];

const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parsePublicHttpsUrl(value: string | undefined, fieldName: string): PublicHttpsUrl {
  const raw = value?.trim();
  if (!raw) {
    throw new BadRequestException(`${fieldName} is required`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(`${fieldName} must be a valid https:// URL`);
  }

  if (url.protocol !== 'https:') {
    throw new BadRequestException(`${fieldName} must use https://`);
  }
  if (url.username || url.password) {
    throw new BadRequestException(`${fieldName} must not include username or password credentials`);
  }

  const hostname = normalizeHostname(url.hostname);
  assertPublicDomain(hostname, fieldName);

  return { value: raw, hostname };
}

export function normalizeOptionalPublicHttpsUrl(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return parsePublicHttpsUrl(value, fieldName).value;
}

export function normalizeCreativeDestination(input: {
  destinationUrl: string;
  displayDomain: string;
}): { destinationUrl: string; displayDomain: string } {
  const destination = parsePublicHttpsUrl(input.destinationUrl, 'destinationUrl');
  return {
    destinationUrl: destination.value,
    displayDomain: normalizeDisplayDomain(input.displayDomain, destination.hostname),
  };
}

export function normalizeCreativeUpdate(
  input: {
    destinationUrl?: string;
    displayDomain?: string;
  },
  existingDestinationUrl: string,
): { destinationUrl?: string; displayDomain?: string } {
  const updates: { destinationUrl?: string; displayDomain?: string } = {};
  let destinationHostname: string | undefined;

  if (input.destinationUrl !== undefined) {
    const destination = parsePublicHttpsUrl(input.destinationUrl, 'destinationUrl');
    updates.destinationUrl = destination.value;
    destinationHostname = destination.hostname;
  }

  if (input.displayDomain !== undefined) {
    const hostname = destinationHostname ?? parsePublicHttpsUrl(existingDestinationUrl, 'existing destinationUrl').hostname;
    updates.displayDomain = normalizeDisplayDomain(input.displayDomain, hostname);
  } else if (destinationHostname !== undefined) {
    updates.displayDomain = destinationHostname;
  }

  return updates;
}

function normalizeDisplayDomain(value: string, destinationHostname: string): string {
  const raw = value.trim();
  if (!raw) {
    throw new BadRequestException('displayDomain is required');
  }
  if (/[:/@?#\\\s]/.test(raw)) {
    throw new BadRequestException('displayDomain must be a hostname without scheme, path, port, or credentials');
  }

  const displayDomain = normalizeHostname(raw);
  assertPublicDomain(displayDomain, 'displayDomain');

  if (!domainsMatch(displayDomain, destinationHostname)) {
    throw new BadRequestException('displayDomain must match the destinationUrl hostname');
  }

  return displayDomain;
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const withoutBrackets = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  return withoutBrackets.endsWith('.') ? withoutBrackets.slice(0, -1) : withoutBrackets;
}

function assertPublicDomain(hostname: string, fieldName: string): void {
  if (!hostname) {
    throw new BadRequestException(`${fieldName} must include a hostname`);
  }
  if (isIP(hostname) !== 0) {
    throw new BadRequestException(`${fieldName} must use a public domain name, not an IP address`);
  }
  if (RESERVED_HOSTNAMES.has(hostname) || RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new BadRequestException(`${fieldName} must use a public domain name`);
  }
  if (!hostname.includes('.')) {
    throw new BadRequestException(`${fieldName} must use a public domain name`);
  }

  const labels = hostname.split('.');
  if (labels.some((label) => !HOST_LABEL_RE.test(label))) {
    throw new BadRequestException(`${fieldName} must use a valid hostname`);
  }
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) {
    throw new BadRequestException(`${fieldName} must use a public domain name`);
  }
}

function domainsMatch(displayDomain: string, destinationHostname: string): boolean {
  return stripWww(displayDomain) === stripWww(destinationHostname);
}

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

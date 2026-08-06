#!/usr/bin/env node
/** Validate deterministic scenario manifests and audit sanitized event traces. */
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED = [
  'id',
  'catalogId',
  'version',
  'persona',
  'environment',
  'seed',
  'actions',
  'expected',
  'forbidden',
  'tolerances',
];
const FORBIDDEN_STRUCTURE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Secret-container canaries. Traces are privacy evidence: any of these
 * containers means the sanitization pipeline leaked. Matches are reported by
 * NAME only — never the matched text, so a leak cannot be echoed into logs.
 */
const PRIVACY_CANARY_PATTERNS = [
  { name: 'pem private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'auth bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { name: 'provider secret', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'webhook secret', re: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { name: 'github token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
  { name: 'aws access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
];

export function findPrivacyCanaries(text) {
  const found = [];
  for (const { name, re } of PRIVACY_CANARY_PATTERNS) {
    if (re.test(text)) found.push(name);
  }
  return found;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateManifest(manifest) {
  const errors = REQUIRED.filter((key) => !(key in manifest)).map((key) => `missing ${key}`);
  if (!/^[a-z0-9][a-z0-9-]+$/.test(manifest.id ?? '')) errors.push('id must be kebab-case');
  if (!Number.isInteger(manifest.catalogId) || manifest.catalogId < 1)
    errors.push('catalogId must be a positive integer');
  if (!Number.isInteger(manifest.version) || manifest.version < 1)
    errors.push('version must be a positive integer');
  if (!['sandbox', 'test'].includes(manifest.environment))
    errors.push('environment must be sandbox or test');
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0)
    errors.push('actions must be non-empty');
  if (manifest.expected?.financialMode !== 'sandbox' || manifest.expected?.hasCashValue !== false)
    errors.push('scenario must be non-cash sandbox mode');
  for (const key of ['eventTypes', 'placementTypes'])
    if (!Array.isArray(manifest.expected?.[key])) errors.push(`expected.${key} must be an array`);
  for (const key of ['eventTypes', 'fields'])
    if (!Array.isArray(manifest.forbidden?.[key])) errors.push(`forbidden.${key} must be an array`);
  if (manifest.reporting !== undefined) {
    if (
      !manifest.reporting ||
      typeof manifest.reporting !== 'object' ||
      Array.isArray(manifest.reporting)
    )
      errors.push('reporting must be an object');
    else {
      if (
        manifest.reporting.severity !== undefined &&
        !['critical', 'high', 'medium', 'low'].includes(manifest.reporting.severity)
      )
        errors.push('reporting.severity must be critical, high, medium, or low');
      if (
        manifest.reporting.reproductionConfidence !== undefined &&
        (!Number.isFinite(manifest.reporting.reproductionConfidence) ||
          manifest.reporting.reproductionConfidence < 0 ||
          manifest.reporting.reproductionConfidence > 1)
      )
        errors.push('reporting.reproductionConfidence must be between 0 and 1');
      if (
        manifest.reporting.evidenceArtifacts !== undefined &&
        (!Array.isArray(manifest.reporting.evidenceArtifacts) ||
          manifest.reporting.evidenceArtifacts.some((value) => typeof value !== 'string'))
      )
        errors.push('reporting.evidenceArtifacts must be an array of strings');
    }
  }
  return errors;
}

function collectKeys(value, prefix = '', keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(prefix ? `${prefix}.${key}` : key);
    collectKeys(child, prefix ? `${prefix}.${key}` : key, keys);
  }
  return keys;
}

function auditTrace(manifest, trace) {
  const errors = [];
  const events = Array.isArray(trace) ? trace : trace.events;
  if (!Array.isArray(events)) return ['trace must be an array or an object with events'];
  const ids = new Set();
  const types = new Set();
  const placements = new Set();
  let duplicates = 0;
  for (const event of events) {
    if (!event || typeof event !== 'object') {
      errors.push('trace contains a non-object event');
      continue;
    }
    if (!event.eventId) errors.push('event missing canonical eventId');
    if (!event.eventType) errors.push('event missing canonical eventType');
    if (event.eventId) {
      if (ids.has(event.eventId)) duplicates += 1;
      ids.add(event.eventId);
    }
    if (event.eventType) types.add(event.eventType);
    if (event.placementType) placements.add(event.placementType);
    if ('mode' in event && !['sandbox', 'test'].includes(event.mode))
      errors.push(`unsafe financial mode ${String(event.mode)}`);
    if ('financialMode' in event && event.financialMode !== 'sandbox')
      errors.push(`unsafe financial mode ${String(event.financialMode)}`);
    if ('hasCashValue' in event && event.hasCashValue !== false)
      errors.push('cash-value truth label must be false');
    const keys = collectKeys(event);
    for (const key of keys) {
      const leaf = key.split('.').at(-1);
      if (leaf && FORBIDDEN_STRUCTURE_KEYS.has(leaf))
        errors.push(`forbidden structure key ${leaf}`);
    }
    for (const field of manifest.forbidden.fields)
      if ([...keys].some((key) => key === field || key.endsWith(`.${field}`)))
        errors.push(`forbidden field ${field}`);
    if (manifest.forbidden.eventTypes.includes(event.eventType))
      errors.push(`forbidden event ${event.eventType}`);
  }
  const missingEvents = manifest.expected.eventTypes.filter((eventType) => !types.has(eventType));
  const missingPlacements = manifest.expected.placementTypes.filter(
    (placementType) => !placements.has(placementType),
  );
  if (duplicates > manifest.tolerances.duplicateCanonicalEvents)
    errors.push(`duplicate canonical events: ${duplicates}`);
  if (missingEvents.length > manifest.tolerances.missingExpectedEventTypes)
    errors.push(`missing expected events: ${missingEvents.join(',')}`);
  if (missingPlacements.length)
    errors.push(`missing expected placements: ${missingPlacements.join(',')}`);
  for (const canary of findPrivacyCanaries(JSON.stringify(events)))
    errors.push(`privacy canary triggered: ${canary}`);
  return errors;
}

export { auditTrace, validateManifest };

if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = process.argv[2] ?? 'scenarios/sandbox';
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const errors = [];
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const manifest = readJson(fullPath);
    for (const error of validateManifest(manifest)) errors.push(`${fullPath}: ${error}`);
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Scenario manifests valid: ${files.length}`);
}

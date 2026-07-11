import { describe, expect, it } from 'vitest';

import { formatCurrency } from './format';
import { normalizeToolType } from './tool-types';

describe('normalizeToolType', () => {
  it('maps known tool names to their enum values', () => {
    expect(normalizeToolType('claude_code')).toBe('claude_code');
    expect(normalizeToolType('codex_cli')).toBe('codex_cli');
    expect(normalizeToolType('cursor')).toBe('cursor');
    expect(normalizeToolType('cline')).toBe('cline');
    expect(normalizeToolType('windsurf')).toBe('windsurf');
    expect(normalizeToolType('aider')).toBe('aider');
    expect(normalizeToolType('vscode')).toBe('vscode');
    expect(normalizeToolType('terminal')).toBe('terminal');
    expect(normalizeToolType('browser')).toBe('browser');
  });

  it('maps hyphenated names correctly', () => {
    expect(normalizeToolType('claude-code')).toBe('claude_code');
    expect(normalizeToolType('codex-cli')).toBe('codex_cli');
  });

  it('is case-insensitive', () => {
    expect(normalizeToolType('CLAUDE_CODE')).toBe('claude_code');
    expect(normalizeToolType('Cursor')).toBe('cursor');
    expect(normalizeToolType('VSCode')).toBe('vscode');
  });

  it('falls back to terminal for unknown tools', () => {
    expect(normalizeToolType('unknown-tool')).toBe('terminal');
    expect(normalizeToolType('makefile')).toBe('terminal');
    expect(normalizeToolType('')).toBe('terminal');
  });

  it('sanitizes special characters in input', () => {
    expect(normalizeToolType('claude code')).toBe('claude_code');
    // Unknown tool after sanitization falls back to 'terminal'
    expect(normalizeToolType('my@tool!')).toBe('terminal');
  });
});

describe('formatCurrency', () => {
  it('formats minor units to USD string', () => {
    expect(formatCurrency(100)).toBe('$1.00');
    expect(formatCurrency(1050)).toBe('$10.50');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(9999)).toBe('$99.99');
  });
});

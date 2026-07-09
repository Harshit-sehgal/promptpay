import { describe, expect, it } from 'vitest';

// A-033: The comparison page marks six tools as "Live": VS Code Extension,
// Cursor, Windsurf, Cline, Claude Code, and Terminal. These are marketing
// assertions layered over just TWO real client codebases:
//   - 'vscode-extension' — the WaitLayer VS Code extension. Cursor, Windsurf,
//     and Cline are VS Code forks/extensions that run this same extension.
//   - 'cli'              — the WaitLayer CLI. Claude Code and Terminal are both
//     driven by this same CLI codebase.
//
// This test codifies that mapping so the "Live" claims stay anchored to code
// that actually exists. It intentionally does not assert on the displayed
// statuses (a product call) — only that the "Live" set collapses to the two
// real codebases.

type ClientCodebase = 'vscode-extension' | 'cli';

// slug -> real codebase that powers the "Live" claim for that tool.
const LIVE_TOOL_CODEBASES: Record<string, ClientCodebase> = {
  vscode: 'vscode-extension',
  cursor: 'vscode-extension',
  windsurf: 'vscode-extension',
  cline: 'vscode-extension',
  'claude-code': 'cli',
  terminal: 'cli',
};

describe('comparison page "Live" tool claims (A-033)', () => {
  it('resolves every Live tool to one of the two real client codebases', () => {
    const codebases = new Set(Object.values(LIVE_TOOL_CODEBASES));
    expect(codebases).toEqual(new Set<ClientCodebase>(['vscode-extension', 'cli']));
  });

  it('covers all six tools marked Live on the comparison page', () => {
    expect(Object.keys(LIVE_TOOL_CODEBASES).sort()).toEqual([
      'claude-code',
      'cline',
      'cursor',
      'terminal',
      'vscode',
      'windsurf',
    ]);
  });

  it('maps the VS Code family (Cursor/Windsurf/Cline) to the shared extension', () => {
    expect(LIVE_TOOL_CODEBASES.cursor).toBe('vscode-extension');
    expect(LIVE_TOOL_CODEBASES.windsurf).toBe('vscode-extension');
    expect(LIVE_TOOL_CODEBASES.cline).toBe('vscode-extension');
    expect(LIVE_TOOL_CODEBASES.cursor).toBe(LIVE_TOOL_CODEBASES.vscode);
  });

  it('maps Claude Code and Terminal to the shared CLI codebase', () => {
    expect(LIVE_TOOL_CODEBASES['claude-code']).toBe('cli');
    expect(LIVE_TOOL_CODEBASES.terminal).toBe('cli');
    expect(LIVE_TOOL_CODEBASES['claude-code']).toBe(LIVE_TOOL_CODEBASES.terminal);
  });
});

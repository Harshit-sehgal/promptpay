/**
 * Map user-supplied tool names to valid ToolType enum values.
 * Common AI tools → their enum value; unknown → 'terminal' (generic catch-all).
 */
export function normalizeToolType(raw: string): string {
  const TOOL_MAP: Record<string, string> = {
    claude: 'claude_code',
    claude_code: 'claude_code',
    'claude-code': 'claude_code',
    codex_cli: 'codex_cli',
    'codex-cli': 'codex_cli',
    codex: 'codex_cli',
    cursor: 'cursor',
    cline: 'cline',
    windsurf: 'windsurf',
    aider: 'aider',
    vscode: 'vscode',
    terminal: 'terminal',
    browser: 'browser',
  };
  const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return TOOL_MAP[key] ?? 'terminal';
}

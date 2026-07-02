import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TOOLS = [
  { slug: 'vscode', name: 'VS Code', type: 'vscode' as const, minVersion: null },
  { slug: 'cursor', name: 'Cursor', type: 'cursor' as const, minVersion: null },
  { slug: 'cline', name: 'Cline', type: 'cline' as const, minVersion: null },
  { slug: 'windsurf', name: 'Windsurf', type: 'windsurf' as const, minVersion: null },
  { slug: 'aider', name: 'Aider', type: 'aider' as const, minVersion: null },
  { slug: 'codex-cli', name: 'Codex CLI', type: 'codex_cli' as const, minVersion: null },
  { slug: 'claude-code', name: 'Claude Code', type: 'claude_code' as const, minVersion: null },
  { slug: 'terminal', name: 'Terminal', type: 'terminal' as const, minVersion: null },
  { slug: 'browser', name: 'Browser Extension', type: 'browser' as const, minVersion: null },
];

async function main() {
  console.log('Seeding ToolIntegration records...');

  for (const tool of TOOLS) {
    await prisma.toolIntegration.upsert({
      where: { slug: tool.slug },
      update: { name: tool.name, type: tool.type, minVersion: tool.minVersion },
      create: tool,
    });
    console.log(`  ✓ ${tool.slug}`);
  }

  console.log('Done seeding tools.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
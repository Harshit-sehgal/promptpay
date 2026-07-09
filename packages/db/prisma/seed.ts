import { prisma } from '../src/index';

// Stable IDs so the seed is idempotent (re-running upserts the same rows).
const DEMO_ADVERTISER_USER_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_ADVERTISER_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_CAMPAIGN_ID = '33333333-3333-3333-3333-333333333333';
const DEMO_CREATIVE_ID = '44444444-4444-4444-4444-444444444444';
const DEMO_DEVELOPER_USER_ID = '55555555-5555-5555-5555-555555555555';
const DEMO_PAYOUT_ACCOUNT_ID = '66666666-6666-6666-6666-666666666666';

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

// Sensible retention defaults (mirror apps/api ComplianceService.DEFAULT_RETENTION_DAYS).
const RETENTION_DEFAULTS: { category: string; retainDays: number }[] = [
  { category: 'webhook_events', retainDays: 90 },
  { category: 'audit_logs', retainDays: 365 },
  { category: 'sessions', retainDays: 30 },
  { category: 'export_cache', retainDays: 7 },
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

  console.log('Seeding data-retention defaults...');
  for (const { category, retainDays } of RETENTION_DEFAULTS) {
    await prisma.dataRetentionConfig.upsert({
      where: { category },
      update: {},
      create: { category, retainDays },
    });
    console.log(`  ✓ ${category} (${retainDays}d)`);
  }

  console.log('Seeding demo advertiser + campaign + creative (draft, not serving)...');
  await prisma.user.upsert({
    where: { id: DEMO_ADVERTISER_USER_ID },
    update: {},
    create: {
      id: DEMO_ADVERTISER_USER_ID,
      email: 'demo-advertiser@waitlayer.dev',
      name: 'Demo Advertiser',
      role: 'advertiser',
      status: 'active',
      trustLevel: 'normal',
      country: 'US',
      emailVerified: true,
      referralCode: 'DEMOAD',
    },
  });
  await prisma.advertiser.upsert({
    where: { id: DEMO_ADVERTISER_ID },
    update: {},
    create: {
      id: DEMO_ADVERTISER_ID,
      userId: DEMO_ADVERTISER_USER_ID,
      companyName: 'Demo Advertiser Inc.',
      billingEmail: 'billing@waitlayer.dev',
      websiteUrl: 'https://waitlayer.dev',
    },
  });
  await prisma.campaign.upsert({
    where: { id: DEMO_CAMPAIGN_ID },
    update: {},
    create: {
      id: DEMO_CAMPAIGN_ID,
      advertiserId: DEMO_ADVERTISER_ID,
      name: 'Demo Campaign (draft)',
      status: 'draft',
      category: 'developer-tools',
      bidType: 'cpm',
      bidAmountMinor: 2000,
      budgetTotalMinor: 50000,
      currency: 'USD',
    },
  });
  await prisma.adCreative.upsert({
    where: { id: DEMO_CREATIVE_ID },
    update: {},
    create: {
      id: DEMO_CREATIVE_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      title: 'Boost your AI workflow',
      sponsoredMessage: 'Try the tool developers love during wait time.',
      destinationUrl: 'https://waitlayer.dev/demo',
      displayDomain: 'waitlayer.dev',
      status: 'draft',
    },
  });

  console.log('Seeding demo developer + payout account (manual, no real money)...');
  await prisma.user.upsert({
    where: { id: DEMO_DEVELOPER_USER_ID },
    update: {},
    create: {
      id: DEMO_DEVELOPER_USER_ID,
      email: 'demo-developer@waitlayer.dev',
      name: 'Demo Developer',
      role: 'developer',
      status: 'active',
      trustLevel: 'normal',
      country: 'US',
      emailVerified: true,
    },
  });
  await prisma.payoutAccount.upsert({
    where: { id: DEMO_PAYOUT_ACCOUNT_ID },
    update: {},
    create: {
      id: DEMO_PAYOUT_ACCOUNT_ID,
      userId: DEMO_DEVELOPER_USER_ID,
      provider: 'manual',
      destination: 'demo-developer@example.com',
      currency: 'USD',
      isVerified: false,
      isActive: true,
    },
  });

  console.log('Done seeding demo + default data.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

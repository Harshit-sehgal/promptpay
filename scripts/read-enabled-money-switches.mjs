// Print the space-separated `scope.target` of every ENABLED money switch in a
// database, or nothing when all are fail-closed.
//
// The production boot smoke asserts every switch is disabled — a real
// deployment gate. But its default target is the SHARED `ateva_test`
// database, and the integration suites deliberately enable these switches in
// their `beforeAll`. Running the smoke straight after the integration suite
// therefore reported a "money switch unexpectedly ENABLED" failure for a
// perfectly good build. The smoke uses this to name that leftover state up
// front instead of surfacing it as a deployment defect five minutes later.
import { createRequire } from 'node:module';

const require = createRequire(process.cwd() + '/apps/api/package.json');
const { PrismaClient, createPrismaAdapter } = require('@ateva/db');

const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
try {
  const rows = await prisma.systemSetting.findMany();
  const enabled = rows
    .filter((row) => row?.value && typeof row.value === 'object' && row.value.enabled === true)
    .map((row) => `${row.scope}.${row.target}`)
    .sort();
  if (enabled.length > 0) process.stdout.write(enabled.join(' '));
} catch {
  // No schema yet (cold start) — the smoke migrates before it asserts.
} finally {
  await prisma.$disconnect();
}

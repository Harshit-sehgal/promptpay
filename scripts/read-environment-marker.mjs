// Print the existing environment id for a database, or nothing if unmarked.
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/apps/api/package.json');
const { PrismaClient, createPrismaAdapter } = require('@ateva/db');
const p = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
try {
  const m = await p.environmentMarker.findUnique({ where: { id: 1 } });
  if (m) process.stdout.write(m.environmentId);
} catch {
  /* unmarked or no schema — caller stamps */
} finally {
  await p.$disconnect();
}

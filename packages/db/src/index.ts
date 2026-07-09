import { type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as {
  prisma: PrismaClient | undefined;
} & typeof globalThis;

/**
 * Default conservative PostgreSQL pool limits.
 * In Prisma 6 these were passed as `connection_limit` / `pool_timeout` query
 * params on the datasource URL. In Prisma 7 the datasource URL is gone and the
 * driver adapter manages the pool directly via `pg`, so we map them onto the
 * equivalent `pg.PoolConfig` options.
 */
const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Build the Prisma 7 PostgreSQL driver adapter.
 *
 * Prisma 7 removed the datasource `url` and requires a driver adapter at
 * runtime. We use the official `pg`-backed adapter. Any legacy
 * `connection_limit` / `pool_timeout` query params on the URL are translated to
 * `pg` pool options so operators can still tune the pool.
 */
export function createPrismaAdapter(connectionString: string): PrismaPg {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required to construct the Prisma client (Prisma 7 driver adapter).',
    );
  }

  const { url, max, connectionTimeoutMillis } = parsePoolParams(connectionString);

  const poolConfig: PoolConfig = {
    connectionString: url,
    max,
    connectionTimeoutMillis,
  };

  return new PrismaPg(poolConfig);
}

function parsePoolParams(raw: string): {
  url: string;
  max: number;
  connectionTimeoutMillis: number;
} {
  let max = DEFAULT_MAX_CONNECTIONS;
  let connectionTimeoutMillis = DEFAULT_CONNECTION_TIMEOUT_MS;
  let url = raw;

  try {
    const u = new URL(raw);
    const cl = u.searchParams.get('connection_limit');
    const pt = u.searchParams.get('pool_timeout');
    if (cl) {
      const parsed = parseInt(cl, 10);
      if (!Number.isNaN(parsed) && parsed > 0) max = parsed;
      u.searchParams.delete('connection_limit');
    }
    if (pt) {
      const parsed = parseInt(pt, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        connectionTimeoutMillis = parsed * 1000;
      }
      u.searchParams.delete('pool_timeout');
    }
    url = u.toString();
  } catch {
    // Not a parseable URL — leave as-is and let `pg` surface the error on connect.
  }

  return { url, max, connectionTimeoutMillis };
}

// Fallback avoids throwing during module load in contexts where DATABASE_URL is
// not yet present (e.g. unit tests that mock the client). The real app always
// provides DATABASE_URL via validated environment config before Prisma boots.
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/waitlayer?schema=public';
const adapter = createPrismaAdapter(connectionString);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Re-export generated Prisma types/enums so app packages consume the DB
// contract through this package instead of depending on @prisma/client.
export {
  ApprovalDecision,
  BidType,
  CampaignStatus,
  CreativeStatus,
  type EarningsLedger,
  EventType,
  FraudFlagStatus,
  FraudFlagType,
  FraudSeverity,
  LedgerEntryType,
  LedgerStatus,
  PayoutProvider,
  PayoutStatus,
  Prisma,
  PrismaClient,
  RecoveryDebtCaseStatus,
  ToolTypeEnum,
  TrustLevel,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as {
  prisma: PrismaClient | undefined;
} & typeof globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
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

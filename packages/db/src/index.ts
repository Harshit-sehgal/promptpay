import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

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

// Re-export the `Prisma` namespace (types like InputJsonValue, *WhereInput,
// TransactionClient) so app packages can consume them without depending on
// @prisma/client directly.
export { PrismaClient, Prisma } from '@prisma/client';

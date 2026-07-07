-- Operator workflow for unrecovered paid-fraud recovery debt.
--
-- Existing recovery debits reduce future payout availability automatically, but
-- users with no future confirmed earnings still need an auditable collections
-- workflow. A case records the current debt snapshot, external reference, and
-- terminal outcome without mutating the immutable earnings ledger rows.
CREATE TYPE "RecoveryDebtCaseStatus" AS ENUM (
  'open',
  'in_collections',
  'recovered',
  'written_off',
  'closed'
);

CREATE TABLE "recovery_debt_cases" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "RecoveryDebtCaseStatus" NOT NULL DEFAULT 'open',
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "externalReference" TEXT,
  "note" TEXT,
  "openedByUserId" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recovery_debt_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recovery_debt_cases_userId_currency_idx"
  ON "recovery_debt_cases" ("userId", "currency");

-- Prisma schema cannot express this partial uniqueness directly. It is the
-- database race guard that prevents two concurrently-created active collection
-- cases for the same developer and currency.
CREATE UNIQUE INDEX "recovery_debt_cases_active_user_currency_key"
  ON "recovery_debt_cases" ("userId", "currency")
  WHERE "status" IN ('open', 'in_collections');

CREATE INDEX "recovery_debt_cases_status_updatedAt_idx"
  ON "recovery_debt_cases" ("status", "updatedAt");

CREATE INDEX "recovery_debt_cases_openedByUserId_createdAt_idx"
  ON "recovery_debt_cases" ("openedByUserId", "createdAt");

CREATE INDEX "recovery_debt_cases_resolvedByUserId_resolvedAt_idx"
  ON "recovery_debt_cases" ("resolvedByUserId", "resolvedAt");

ALTER TABLE "recovery_debt_cases"
  ADD CONSTRAINT "recovery_debt_cases_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_debt_cases"
  ADD CONSTRAINT "recovery_debt_cases_openedByUserId_fkey"
  FOREIGN KEY ("openedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recovery_debt_cases"
  ADD CONSTRAINT "recovery_debt_cases_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

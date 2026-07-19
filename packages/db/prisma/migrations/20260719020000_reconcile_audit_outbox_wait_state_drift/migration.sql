-- Reconcile schema.prisma <-> live database drift surfaced by `prisma migrate diff`.
-- The 58 applied migrations left audit_outbox.processed_at / failed_at as a
-- non-TIMESTAMP(3) type and a stale wait_state_events index that schema.prisma
-- no longer declares. Align the database to the intended schema with no data
-- loss (TIMESTAMP(3) is precision-only; the dropped index is unused).

-- DropIndex
DROP INDEX "wait_state_events_waitStateId_eventType_idx";

-- AlterTable
ALTER TABLE "audit_outbox" ALTER COLUMN "processed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "failed_at" SET DATA TYPE TIMESTAMP(3);

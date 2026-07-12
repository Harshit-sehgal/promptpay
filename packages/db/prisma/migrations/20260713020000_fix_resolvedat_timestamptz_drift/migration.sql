-- Correct `@db.Timestamptz` drift on `ad_reports.resolvedAt`.
-- schema.prisma declares `@db.Timestamptz` but the column was never converted
-- from the 0_init plain TIMESTAMP(3) — migration 20260704050000 only converted
-- `fraud_flags.resolvedAt`, not `ad_reports.resolvedAt`.
--
-- Also fix the reverse drift on `fraud_flags.resolvedAt`: the migration
-- converted it to TIMESTAMPTZ but schema.prisma has no `@db.Timestamptz`
-- annotation — fixed in the schema, not this SQL (schema-only change for
-- matching the existing DB type).

ALTER TABLE "ad_reports"
  ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMPTZ(3)
  USING ("resolvedAt" AT TIME ZONE 'UTC');
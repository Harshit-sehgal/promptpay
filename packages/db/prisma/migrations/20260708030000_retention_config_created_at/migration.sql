-- Track when each retention-config row was first seeded so operators can
-- audit retention-policy changes over time (previously only updatedAt existed).

ALTER TABLE "data_retention_config" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

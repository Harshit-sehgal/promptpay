-- Cross-user uniqueness on device fingerprint — closes the TOCTOU between
-- two users concurrently registering the same physical device. Without a
-- DB-level unique constraint, the JS-level duplicate check could race and
-- both users could register the same fingerprint. With this unique index,
-- the second create hits a unique violation (P2002), which the service
-- catches and translates into a duplicate_device fraud flag.
--
-- Note: this migration assumes all existing rows have unique fingerprintHash
-- values. If duplicates exist in the live database they must be resolved
-- manually before applying. The previous compound unique (userId,
-- fingerprintHash) remains in place.
CREATE UNIQUE INDEX "devices_fingerprintHash_key" ON "devices"("fingerprintHash");

-- The existing index on fingerprintHash can stay (the unique index
-- supersedes it for query purposes; dropping the redundant index keeps
-- storage tight and updates fast).
DROP INDEX IF EXISTS "devices_fingerprintHash_idx";

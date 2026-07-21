-- The original removal migration dropped a unique *constraint*, but older
-- databases carry this uniqueness as an index. Drop the index explicitly so
-- cross-user device-fingerprint collisions reach the fraud-review flow while
-- the per-user uniqueness constraint remains intact.

DROP INDEX IF EXISTS "devices_fingerprintHash_key";

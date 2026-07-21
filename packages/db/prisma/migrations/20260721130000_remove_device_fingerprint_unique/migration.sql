-- Remove the global unique constraint on device fingerprints.
-- Cross-user collisions are now detected as high-severity fraud signals with
-- manual review, rather than hard registration blocks.
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_fingerprintHash_key";

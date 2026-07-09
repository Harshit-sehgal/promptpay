-- A-009: support privacy-minimized anonymous (logged-out) server-side consent.
-- Previously the Consent row required a non-null `userId`, which forced all
-- consent to be tied to an authenticated account. Logged-out visitors could
-- only persist consent in the browser (localStorage), leaving no server
-- auditable record. We now allow `userId` to be NULL and store a sha256 hash
-- of a client-generated pseudonymous visitor id instead of any PII.
-- Idempotent so it is safe to re-run where the column/constraint already exist.

-- Make the FK column nullable. The foreign key constraint itself stays intact;
-- a NULL userId simply means the consent is anonymous.
ALTER TABLE "consents" ALTER COLUMN "userId" DROP NOT NULL;

-- Pseudonymous visitor id hash for anonymous consent (no raw id / IP / PII).
ALTER TABLE "consents" ADD COLUMN IF NOT EXISTS "visitorIdHash" TEXT;

-- Index to look up / dedupe anonymous consent by visitor + purpose.
CREATE INDEX IF NOT EXISTS "consents_visitorIdHash_idx" ON "consents" ("visitorIdHash");

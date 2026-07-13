BEGIN;

-- Authentication treats email addresses as canonical lower-case identifiers.
-- Stop before changing data if legacy rows would collapse to one identity;
-- operators must merge/rename those accounts deliberately rather than letting
-- an arbitrary row win during deployment.
DO $$
DECLARE
  duplicate_emails text;
BEGIN
  SELECT string_agg(canonical_email, ', ' ORDER BY canonical_email)
    INTO duplicate_emails
    FROM (
      SELECT lower(btrim("email")) AS canonical_email
        FROM "users"
       GROUP BY lower(btrim("email"))
      HAVING count(*) > 1
       LIMIT 20
    ) duplicates;

  IF duplicate_emails IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot canonicalize users.email: case/whitespace-equivalent duplicate accounts exist',
      DETAIL = duplicate_emails,
      HINT = 'Merge or rename the listed accounts, then rerun prisma migrate deploy.';
  END IF;
END $$;

UPDATE "users"
   SET "email" = lower(btrim("email"))
 WHERE "email" IS DISTINCT FROM lower(btrim("email"));

-- The existing users_email_key unique constraint now enforces uniqueness over
-- canonical values. This CHECK prevents any direct SQL/import path from
-- reintroducing mixed-case or whitespace-padded identities.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_canonical_check"
  CHECK ("email" = lower(btrim("email")));

COMMIT;

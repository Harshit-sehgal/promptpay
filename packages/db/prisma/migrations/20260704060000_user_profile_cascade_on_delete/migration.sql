-- Align user-owned 1:1 profile FKs with the rest of the User cascade surface.
-- AdminUser and Advertiser are owned sub-profiles (userId @unique, 1:1 with User).
-- The 0_init migration created these FKs as ON DELETE RESTRICT, which is
-- inconsistent with Session/Device/UserSettings/PayoutAccount/TrustScore (all
-- CASCADE from User). RESTRICT blocks hard-deleting a User because the profile
-- row lingers, requiring manual cleanup in an undefined order. Aligning to
-- CASCADE lets a User deletion (admin/operational) cleanly remove the profile,
-- matching the schema annotations and the rest of the User relation tree.

ALTER TABLE "admin_users" DROP CONSTRAINT "admin_users_userId_fkey";
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "advertisers" DROP CONSTRAINT "advertisers_userId_fkey";
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

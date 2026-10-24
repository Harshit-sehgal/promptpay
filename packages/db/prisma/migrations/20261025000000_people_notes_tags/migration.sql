-- People CRM: admin notes and tags on registered users and waitlist entries,
-- plus createdAt indexes for the newest-first signup lists. Additive only.
-- person_notes.subjectId / person_tags.subjectId point at users.id or
-- advertiser_waitlist.id depending on subjectType, so they carry no foreign
-- key; erasure paths delete the rows in the same transaction.
CREATE TYPE "PersonSubject" AS ENUM ('user', 'waitlist');

CREATE TABLE "person_notes" (
  "id" TEXT NOT NULL,
  "subjectType" "PersonSubject" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "authorId" TEXT,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "person_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "person_tags" (
  "subjectType" "PersonSubject" NOT NULL,
  "subjectId" TEXT NOT NULL,
  "tag" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "person_tags_pkey" PRIMARY KEY ("subjectType", "subjectId", "tag")
);

CREATE INDEX "person_notes_subjectType_subjectId_createdAt_idx" ON "person_notes"("subjectType", "subjectId", "createdAt");

CREATE INDEX "person_notes_authorId_idx" ON "person_notes"("authorId");

CREATE INDEX "person_tags_tag_idx" ON "person_tags"("tag");

CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

CREATE INDEX "advertiser_waitlist_created_at_idx" ON "advertiser_waitlist"("created_at");

ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

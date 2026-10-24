# People CRM (admin) — design and API contract

Date: 2026-10-25. Branch: `feat/dashboard-redesign`.

## Intent

The operator needs one place to see everyone who has signed up for Ateva and
everyone on the advertiser waitlist: who they are, what they entered, where
they are in the funnel, and to move waitlist entries through the pipeline.
Today `/admin/users` caps at 50 rows with no pagination and few fields, and
`/admin/waitlist` is read-only.

## Decisions

- New admin page `/admin/people` with two tabs: **Registered** and
  **Waitlist**. Existing `/admin/users` (moderation actions) and
  `/admin/waitlist` stay as they are; the sidebar gains a "People" entry.
- No Prisma migration. Production readiness checks pending migrations and
  several docs and tests pin the migration count, so v1 uses existing columns
  only. Free-text notes and tags are deferred (would need a `CrmNote` table).
- Waitlist status transitions use the existing `AdvertiserWaitlistStatus`
  enum (`pending`, `invited`, `onboarded`, `declined`), audit-logged exactly
  like `setUserStatus` (`action: 'admin_set_waitlist_status'`, before/after
  snapshots, no email in the audit row).
- Never expose secrets or pseudonyms: no `passwordHash`, `twoFactorSecret`,
  backup codes, `ipHash`, `visitorIdHash`, device `fingerprintHash`,
  `eventSecret`, `publicKey`, `googleId`, `githubId`.
- Export is JSON from the API (capped at 10 000 rows, audit-logged as
  `admin_exported_people` with kind and row count, no PII in the audit row);
  the browser turns it into CSV. This avoids proxy content-type handling.
- Roles: `admin`, `super_admin`.

## API (NestJS, prefix `admin/people`, JwtAuthGuard + RolesGuard)

All list endpoints: `page` (default 1), `limit` (default 25, max 100), parsed
with `parsePaginationParam`. Dates are ISO strings. BigInt never appears.

### `GET /admin/people/summary`

```json
{
  "users": {
    "total": 0,
    "byRole": { "developer": 0, "advertiser": 0 },
    "byStatus": { "active": 0 },
    "emailVerified": 0,
    "twoFactorEnabled": 0,
    "last7d": 0,
    "last30d": 0
  },
  "waitlist": {
    "total": 0,
    "byStatus": { "pending": 0, "invited": 0, "onboarded": 0, "declined": 0 },
    "last7d": 0,
    "last30d": 0
  },
  "signupsByDay": [{ "date": "2026-10-01", "users": 0, "waitlist": 0 }]
}
```

`signupsByDay` covers the last 30 UTC days, oldest first, every day present
(zero-filled). `byRole`/`byStatus` contain only keys with a count > 0, except
waitlist `byStatus` which always has all four keys.

### `GET /admin/people/users`

Query: `search` (email or name, case-insensitive contains), `role`, `status`,
`country` (ISO-2, case-insensitive), `verified` (`email` | `unverified`),
`from`, `to` (ISO dates on `createdAt`, inclusive day bounds), `page`, `limit`.
Invalid enum values → 400.

```json
{
  "rows": [
    {
      "id": "uuid",
      "email": "a@b.c",
      "name": "A",
      "role": "developer",
      "status": "active",
      "trustLevel": "normal",
      "country": "IN",
      "emailVerified": true,
      "googleVerified": false,
      "githubVerified": true,
      "twoFactorEnabled": false,
      "createdAt": "…",
      "companyName": null,
      "deviceCount": 1,
      "lastSeenAt": "… | null"
    }
  ],
  "total": 0,
  "page": 1,
  "limit": 25
}
```

`companyName` comes from the advertiser profile. `lastSeenAt` is the newest
device `lastSeenAt`, or null.

### `GET /admin/people/users/:id` (ParseUUIDPipe; 404 if missing)

Row fields above plus:

```json
{
  "referralCode": "WAIT-7Q2K",
  "updatedAt": "…",
  "advertiser": { "companyName": "", "billingEmail": "", "websiteUrl": null, "trustStatus": "" },
  "consents": [{ "purpose": "", "version": "", "granted": true, "createdAt": "…" }],
  "devices": [
    {
      "id": "",
      "toolType": "",
      "platform": null,
      "extensionVersion": null,
      "createdAt": "…",
      "lastSeenAt": "…"
    }
  ],
  "referredBy": { "id": "", "email": "" },
  "referralsMade": 0,
  "openFlags": 0
}
```

`advertiser` and `referredBy` are null when absent. Consents newest first,
max 50. Devices newest-seen first, max 50.

### `GET /admin/people/waitlist`

Query: `search` (email or company), `status`, `country`, `page`, `limit`.

```json
{
  "rows": [
    {
      "id": "",
      "email": "",
      "company": null,
      "country": null,
      "status": "pending",
      "consent": true,
      "source": "advertisers_page",
      "createdAt": "…",
      "updatedAt": "…",
      "registeredUserId": null
    }
  ],
  "total": 0,
  "page": 1,
  "limit": 25
}
```

`registeredUserId` is the id of a `User` with the same email
(case-insensitive), or null, so the operator can see who converted.

### `POST /admin/people/waitlist/:id/status` body `{ "status": "invited" }`

Returns the updated row (same shape as a list row). 400 on an invalid status,
404 on an unknown id. Same status → no write, no audit, returns the row.

### `GET /admin/people/export?kind=users|waitlist`

Same filters as the matching list endpoint (no pagination). Returns
`{ "rows": [...list row shape...], "truncated": false }`, newest first, at
most 10 000 rows.

## Web (`apps/web`)

- Proxy allowlist: add `'/admin/people'`.
- `adminApi` in `src/lib/api/services.ts`: `getPeopleSummary`,
  `getPeopleUsers`, `getPeopleUser`, `getPeopleWaitlist`,
  `setWaitlistStatus`, `exportPeople`.
- `/admin/people` page in the ledger style already used by the dashboards
  (`PageHeader`, `Panel`, `Stat`, `.dash-bar` toolbars with tab buttons,
  `.dash-rows`/tables, `ModalDialog` or a side drawer). Contents:
  - stat strip: registered total, last 7 days, waitlist total, waitlist
    pending;
  - a 30-day signups chart (inline SVG bars, users vs waitlist, accessible
    summary text, no chart library);
  - tab "Registered": search, role, status, country, verified filters,
    paginated table, row opens a detail drawer showing every field in the
    detail response;
  - tab "Waitlist": search, status tabs with counts, country filter,
    paginated table, inline status select per row (optimistic, reverts on
    error), "Registered" marker when `registeredUserId` is set (links to
    that person's drawer);
  - "Export CSV" per tab, using the current filters; CSV cells are quoted,
    and values starting with `=`, `+`, `-`, `@` are prefixed with `'`.
  - Tab, filters and page live in the URL query so the view is shareable.
  - Empty, loading, error states; mobile layout at 375px (cards instead of
    a wide table, or a horizontally scrolling table inside its panel).
- Sidebar admin nav: "People" link.

## Deferred

Notes and tags (need a migration), email sending to invitees, bulk status
changes.

## Revision 2026-10-25: notes, tags and the signup index

The deferred items are now in scope. One additive migration
(`20261025000000_people_notes_tags`).

### Schema (packages/db)

```prisma
enum PersonSubject {
  user
  waitlist
}

model PersonNote {
  id          String        @id @default(uuid())
  subjectType PersonSubject
  subjectId   String        // User.id or AdvertiserWaitlist.id; no FK (two targets)
  authorId    String?
  author      User?         @relation("PersonNoteAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  body        String        @db.VarChar(2000)
  createdAt   DateTime      @default(now()) @db.Timestamptz

  @@index([subjectType, subjectId, createdAt])
  @@index([authorId])
  @@map("person_notes")
}

model PersonTag {
  subjectType PersonSubject
  subjectId   String
  tag         String        @db.VarChar(32)
  createdAt   DateTime      @default(now()) @db.Timestamptz

  @@id([subjectType, subjectId, tag])
  @@index([tag])
  @@map("person_tags")
}
```

`User` gains `@@index([createdAt])` and the back-relation
`personNotesAuthored PersonNote[] @relation("PersonNoteAuthor")`.
`AdvertiserWaitlist` gains `@@index([createdAt])` (its existing index leads
with `status`).

Because `subjectId` has no foreign key, every erasure path deletes the
subject's notes and tags in the same transaction: admin user erasure, self
account deletion (developer and advertiser), and
`scripts/erase-waitlist-signup.mjs`. Notes can hold personal data.

### API additions (same controller, same guards; writes are step-up gated)

`:subject` is `users` or `waitlist`; `:id` is a UUID; the subject must exist
(404 otherwise).

- `GET /admin/people/:subject/:id/notes` → `[{ id, body, createdAt, author: { id, email } | null }]`, newest first, max 100.
- `POST /admin/people/:subject/:id/notes` body `{ body }` (trimmed, 1 to 2000 chars) → the note. Audit `admin_added_person_note` with `{ subjectType, noteId }`, never the body.
- `DELETE /admin/people/notes/:noteId` → `{ deleted: true }`; 404 if missing. Audit `admin_deleted_person_note`.
- `PUT /admin/people/:subject/:id/tags` body `{ tags: string[] }` → `{ tags }` sorted. Each tag is lowercased and trimmed, must match `^[a-z0-9][a-z0-9-]{0,31}$`; at most 10 per subject; duplicates collapse. Replaces the set in one transaction. Audit `admin_set_person_tags` with before/after tag lists.
- `GET /admin/people/tags?subject=users|waitlist` → `[{ tag, count }]` sorted by count desc then tag, max 200.
- List rows (users and waitlist) and export rows gain `tags: string[]` (sorted). List and export queries accept `tag` (single value; rows having that tag).
- User detail gains `tags: string[]`.

### Web additions

- Detail dialog (registered user): a Tags editor (chips with remove buttons, a text input that adds on Enter or comma, validation message, saves via PUT) and a Notes section (list newest first with author, time and a Delete button with confirm; a textarea and Add note button).
- Waitlist rows get a "Notes" button opening a waitlist detail dialog with email, company, country, status, source, signup time, the same Tags editor and Notes section.
- Both tables show tags as small chips under the person/email; both toolbars get a Tag filter select fed by `GET /admin/people/tags`; `tag` lives in the URL query.
- CSV exports include a Tags column (tags joined with `; `).
- A 403 from a write shows the API message (the step-up rule asks for a recent two-factor sign-in).

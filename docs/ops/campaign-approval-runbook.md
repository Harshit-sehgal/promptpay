# Campaign Approval Runbook

**Owner:** Admin / Support  
**Frequency:** As campaigns are submitted  
**Scope:** Private beta (Phase 6) through public launch (Phase 7)

---

## 1. Prerequisites

- Admin access to the WaitLayer admin dashboard (`/admin`)
- Listed `admin` or `super_admin` role in the database
- Familiarity with the campaign state machine:
  `draft → submitted → approved → active → paused → active → archived`

---

## 2. Daily Review Process

### 2.1 Check the Queue

1. Navigate to `/admin/campaigns`
2. Review the list of **pending campaigns** (status `submitted`)
3. Sort by `submittedAt` ascending to process oldest first

### 2.2 Review Each Campaign

For each submitted campaign, verify:

| Check | What to Look For | Action if Failed |
|-------|------------------|------------------|
| **Budget** | Minimum $50, maximum $1,000,000 | Reject with reason |
| **CPM/CPC bid** | Must be positive integer (cents) | Reject with reason |
| **Category** | Must be on allowed categories list | Reject — prohibited category |
| **Targeting** | Country targeting must include valid ISO codes | Request correction |
| **Creatives** | At least one creative present; review each | Reject individual creatives |

### 2.3 Creative Review

For each creative (`status: pending_review`):

- [ ] Title is professional and not misleading
- [ ] Sponsored message is accurate
- [ ] Destination URL is a valid `http`/`https` URL
- [ ] Display domain matches the destination
- [ ] Content does not violate prohibited categories
- [ ] No tracking pixels or scripts in the message body
- [ ] No claims about earnings, health benefits, or regulated industries without evidence

**Actions:**
- **Approve** → creative becomes `approved`, eligible for serving
- **Reject** → creative moves to `rejected`, advertiser must submit a new version

### 2.4 Campaign Approval

After at least one creative is approved:

1. Click **Approve Campaign**
2. The campaign transitions:
   - `submitted → active` if at least one approved creative AND remaining budget > 0
   - `submitted → approved` if no approved creative yet or budget exhausted (staged)

---

## 3. Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Campaign won't approve | No approved creatives | Appraise creatives first |
| Campaign approved but not serving | Budget exhausted, paused, or not active | Check campaign status in overview |
| Creative stuck in `pending_review` | Race condition with admin approval | Refresh page and re-submit if needed |
| Country targeting error | Invalid country code | Use ISO 3166-1 alpha-2 codes (US, CA, GB, etc.) |

---

## 4. Escalation

- **Policy violation:** Contact the advertiser via email; reject campaign with detailed note
- **Suspected fraud:** Flag the advertiser account; do not approve campaign; escalate to fraud review
- **Technical bug:** Note the campaign ID and page state; file a bug report

---

## 5. Audit Trail

All approve/reject actions are automatically recorded in the audit log (`/admin/audit`). Each entry includes:
- Admin who performed the action
- Campaign ID
- Decision (approved/rejected)
- Reason/note
- Timestamp

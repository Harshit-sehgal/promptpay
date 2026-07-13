# Disaster Recovery Runbook

> **Scope:** Region-level failures, database corruption, total data loss, and major provider outages.  
> **Owner:** Platform / SRE.  
> **Review cadence:** Quarterly, or after any infrastructure change.

## 1. Objectives

This runbook defines the steps to recover WaitLayer services after a disaster. It covers failover, data restoration, verification, and communication.

## 2. Recovery Time / Point Objectives

| Service                | RTO     | RPO                   |
| ---------------------- | ------- | --------------------- |
| API                    | 4 hours | 1 hour (WAL archive)  |
| Web dashboard          | 4 hours | N/A (static build)    |
| Redis rate-limit state | 1 hour  | 1 hour (RDB snapshot) |

## 3. Disaster Scenarios

### 3.1 Primary database unavailable

1. Confirm the failure with health checks (`/health/ready`).
2. Promote the read replica or restore from the latest backup to a new primary.
3. Update the `DATABASE_URL` environment variable in the application.
4. Restart API pods.
5. Verify with `pnpm --filter waitlayer-api exec vitest run --no-file-parallelism`.

### 3.2 Database corruption

1. Stop all writes immediately.
2. Identify the last known good backup.
3. Restore to a new database instance (see backup-restore-runbook.md).
4. Run data-integrity checks:
   - `admin.getMoneyIntegrityReport()`
   - Campaign spend vs. ledger debit reconciliation
5. Switch traffic to the restored database.

### 3.3 Region outage

1. Activate the standby region (if multi-region deployment exists).
2. Update DNS / load balancer to point to the standby region.
3. Verify database replication lag is acceptable.
4. Notify users of degraded service if applicable.

### 3.4 Total data loss

1. Provision new infrastructure.
2. Restore Postgres from the latest logical dump + WAL archives.
3. Restore Redis from the latest RDB snapshot.
4. Restore object storage from cross-region replica.
5. Rotate all secrets (`JWT_SECRET`, `TOTP_SECRET_ENCRYPTION_KEY`, provider API keys).
6. Run full test suite and smoke tests.
7. Re-enable traffic gradually.

## 4. Communication Plan

| Step | Action                                                         | Owner            |
| ---- | -------------------------------------------------------------- | ---------------- |
| 1    | Open incident channel / war room                               | On-call engineer |
| 2    | Post status page update                                        | Support lead     |
| 3    | Notify affected advertisers/developers if PII/payouts impacted | Legal / Support  |
| 4    | Post-incident review within 5 business days                    | Engineering lead |

## 5. Verification Checklist

After any DR event:

- [ ] API health checks pass.
- [ ] Database migrations are current.
- [ ] Money-integrity report is healthy.
- [ ] Redis rate-limit state is consistent.
- [ ] Critical user flows (signup, login, payout request, ad serving) work.
- [ ] Monitoring and alerting are active.
- [ ] Incident timeline is documented.

## 6. Lessons Learned

After every DR exercise or real event, update this runbook and the backup-restore runbook with lessons learned.

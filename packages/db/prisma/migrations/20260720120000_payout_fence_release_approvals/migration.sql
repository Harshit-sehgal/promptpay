-- P1.11: persistent two-person approval workflow for high-value payout-fence
-- releases. A release request records the requesting operator (Admin A) and a
-- distinct approver (Admin B) with MFA/session evidence, a bounded expiry
-- window, and a decision lifecycle ('pending' | 'approved' | 'rejected' |
-- 'expired') so the second-person control survives process restarts and is
-- auditable end-to-end.

-- CreateTable
CREATE TABLE "payout_fence_release_approvals" (
    "id" TEXT NOT NULL,
    "payout_account_id" TEXT NOT NULL,
    "payout_request_id" TEXT NOT NULL,
    "requested_amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "requester_session_id" TEXT NOT NULL,
    "requester_mfa_at" TIMESTAMPTZ,
    "approver_id" TEXT,
    "approver_session_id" TEXT,
    "approver_mfa_at" TIMESTAMPTZ,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decision" TEXT,
    "reason" TEXT,
    "evidence" JSONB,

    CONSTRAINT "payout_fence_release_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_fence_release_approvals_payout_account_id_idx" ON "payout_fence_release_approvals"("payout_account_id");

-- CreateIndex
CREATE INDEX "payout_fence_release_approvals_payout_request_id_idx" ON "payout_fence_release_approvals"("payout_request_id");

-- CreateIndex
CREATE INDEX "payout_fence_release_approvals_requester_id_idx" ON "payout_fence_release_approvals"("requester_id");

-- CreateIndex
CREATE INDEX "payout_fence_release_approvals_approver_id_idx" ON "payout_fence_release_approvals"("approver_id");

-- CreateIndex
CREATE INDEX "payout_fence_release_approvals_decision_expires_at_idx" ON "payout_fence_release_approvals"("decision", "expires_at");

-- AddForeignKey
ALTER TABLE "payout_fence_release_approvals" ADD CONSTRAINT "payout_fence_release_approvals_payout_account_id_fkey" FOREIGN KEY ("payout_account_id") REFERENCES "payout_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_fence_release_approvals" ADD CONSTRAINT "payout_fence_release_approvals_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "payout_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

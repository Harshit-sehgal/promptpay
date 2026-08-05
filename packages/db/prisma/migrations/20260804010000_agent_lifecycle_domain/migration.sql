CREATE TABLE "environment_markers" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "environment_kind" TEXT NOT NULL,
  "environment_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "environment_markers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "integration_mode" TEXT NOT NULL,
  "provider_session_hash" TEXT,
  "workspace_hash" TEXT,
  "status" TEXT NOT NULL,
  "adapter_version" TEXT NOT NULL,
  "provider_version" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL,
  "ended_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_sessions_correlation_id_key" ON "agent_sessions"("correlation_id");
CREATE UNIQUE INDEX "agent_sessions_userId_deviceId_provider_provider_session_hash_key" ON "agent_sessions"("userId", "deviceId", "provider", "provider_session_hash");
CREATE INDEX "agent_sessions_userId_started_at_idx" ON "agent_sessions"("userId", "started_at");
CREATE INDEX "agent_sessions_deviceId_status_idx" ON "agent_sessions"("deviceId", "status");
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "agent_work_units" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "parent_work_unit_id" TEXT,
  "kind" TEXT NOT NULL,
  "provider_work_unit_hash" TEXT,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL,
  "ended_at" TIMESTAMPTZ,
  "tool_call_count" INTEGER NOT NULL DEFAULT 0,
  "subagent_count" INTEGER NOT NULL DEFAULT 0,
  "outcome_category" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_work_units_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_work_units_sessionId_started_at_idx" ON "agent_work_units"("sessionId", "started_at");
CREATE INDEX "agent_work_units_parent_work_unit_id_idx" ON "agent_work_units"("parent_work_unit_id");
ALTER TABLE "agent_work_units" ADD CONSTRAINT "agent_work_units_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_work_units" ADD CONSTRAINT "agent_work_units_parent_work_unit_id_fkey" FOREIGN KEY ("parent_work_unit_id") REFERENCES "agent_work_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "agent_lifecycle_events" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "work_unit_id" TEXT,
  "event_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sequence" INTEGER,
  "correlation_id" TEXT NOT NULL,
  "causation_id" TEXT,
  "metadata" JSONB NOT NULL,
  "adapter_version" TEXT NOT NULL,
  "client_version" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  CONSTRAINT "agent_lifecycle_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_lifecycle_events_event_id_key" ON "agent_lifecycle_events"("event_id");
CREATE UNIQUE INDEX "agent_lifecycle_events_idempotency_key_key" ON "agent_lifecycle_events"("idempotency_key");
CREATE INDEX "agent_lifecycle_events_sessionId_occurred_at_idx" ON "agent_lifecycle_events"("sessionId", "occurred_at");
CREATE INDEX "agent_lifecycle_events_event_type_occurred_at_idx" ON "agent_lifecycle_events"("event_type", "occurred_at");
CREATE INDEX "agent_lifecycle_events_correlation_id_sequence_idx" ON "agent_lifecycle_events"("correlation_id", "sequence");
ALTER TABLE "agent_lifecycle_events" ADD CONSTRAINT "agent_lifecycle_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_lifecycle_events" ADD CONSTRAINT "agent_lifecycle_events_work_unit_id_fkey" FOREIGN KEY ("work_unit_id") REFERENCES "agent_work_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "attention_windows" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "sessionId" TEXT,
  "state" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL,
  "ended_at" TIMESTAMPTZ,
  "visible_surface" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attention_windows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attention_windows_userId_started_at_idx" ON "attention_windows"("userId", "started_at");
CREATE INDEX "attention_windows_deviceId_started_at_idx" ON "attention_windows"("deviceId", "started_at");
CREATE INDEX "attention_windows_sessionId_started_at_idx" ON "attention_windows"("sessionId", "started_at");
ALTER TABLE "attention_windows" ADD CONSTRAINT "attention_windows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attention_windows" ADD CONSTRAINT "attention_windows_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attention_windows" ADD CONSTRAINT "attention_windows_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ad_opportunities" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "sessionId" TEXT,
  "workUnitId" TEXT,
  "triggerEventId" TEXT,
  "placement_type" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "attention_confidence" DOUBLE PRECISION NOT NULL,
  "integration_confidence" DOUBLE PRECISION NOT NULL,
  "eligible_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "rejection_reason" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ad_opportunities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ad_opportunities_idempotency_key_key" ON "ad_opportunities"("idempotency_key");
CREATE INDEX "ad_opportunities_userId_created_at_idx" ON "ad_opportunities"("userId", "created_at");
CREATE INDEX "ad_opportunities_sessionId_placement_type_idx" ON "ad_opportunities"("sessionId", "placement_type");
CREATE INDEX "ad_opportunities_state_expires_at_idx" ON "ad_opportunities"("state", "expires_at");
ALTER TABLE "ad_opportunities" ADD CONSTRAINT "ad_opportunities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_opportunities" ADD CONSTRAINT "ad_opportunities_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ad_opportunities" ADD CONSTRAINT "ad_opportunities_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

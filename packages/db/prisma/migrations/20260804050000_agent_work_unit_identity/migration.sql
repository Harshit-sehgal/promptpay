CREATE UNIQUE INDEX "agent_work_units_sessionId_kind_provider_work_unit_hash_key"
  ON "agent_work_units"("sessionId", "kind", "provider_work_unit_hash");

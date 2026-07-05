-- Composite single-column index on `sessions.expiresAt` to support the
-- session cleanup cron's `deleteMany({ where: { expiresAt: { lt: cutoff } } })`
-- predicate. Without it the prune is a seq scan that grows with session
-- count, repeated hourly on every API replica.
CREATE INDEX "sessions_expiresAt_idx" ON "sessions" ("expiresAt");

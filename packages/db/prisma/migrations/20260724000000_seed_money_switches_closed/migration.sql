-- Fresh databases must not infer that money paths are enabled merely because
-- an operator has not created a SystemSetting row yet. These rows are
-- intentionally inserted only when absent so an existing audited operator
-- decision is preserved.
INSERT INTO "system_settings" ("id", "scope", "target", "value", "reason")
VALUES
  ('77777777-7777-4777-8777-777777777701', 'ads', 'global', '{"enabled": false}', 'bootstrap fail-closed default'),
  ('77777777-7777-4777-8777-777777777702', 'wait', 'earnings', '{"enabled": false}', 'bootstrap fail-closed default'),
  ('77777777-7777-4777-8777-777777777703', 'deposits', 'global', '{"enabled": false}', 'bootstrap fail-closed default'),
  ('77777777-7777-4777-8777-777777777704', 'payouts', 'requests', '{"enabled": false}', 'bootstrap fail-closed default'),
  ('77777777-7777-4777-8777-777777777705', 'payouts', 'auto', '{"enabled": false}', 'bootstrap fail-closed default')
ON CONFLICT ("scope", "target") DO NOTHING;

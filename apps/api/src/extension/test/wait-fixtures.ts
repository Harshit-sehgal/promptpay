/**
 * Shared wait-state signal fixtures for extension/integration tests.
 *
 * P0.1 (Trusted wait detection) requires corroborating signals before a wait
 * is payment-eligible. Billable waits in tests must include at least one
 * primary signal plus a second distinct signal; a single `ai_generation`
 * signal is ad-eligible but NOT payment-eligible.
 */
export const BILLABLE_WAIT_SIGNALS = [
  { type: 'ai_generation' },
  { type: 'command_execution', details: 'build_start' },
];

/** Single forged signal used by adversarial tests that must NOT earn. */
export const FORGED_SINGLE_SIGNAL = [{ type: 'ai_generation' }];

/**
 * Action-scoped MFA step-up for the web client (A-102).
 *
 * WHY THIS EXISTS
 * ---------------
 * Seven API routes are guarded by `ActionStepUpGuard` and reject any request
 * that arrives without an `x-step-up-token` header:
 *
 *   payout:method    POST/DELETE /payout/method   (register / remove a payout account)
 *   payout:request   POST        /payout/request  (request a payout)
 *   api_key:create   POST        /developer/api-keys
 *   account:delete   POST        /developer/delete-account   (GDPR Art. 17)
 *   account:delete   POST        /advertiser/delete-account  (GDPR Art. 17)
 *   2fa:disable      POST        /auth/2fa/disable
 *
 * No client ever sent that header, and `/auth/step-up` was not even on the BFF
 * proxy allowlist — so the web could not request a token, let alone use one.
 * Every one of those actions returned 403 "Step-up authentication is required
 * for this action" forever. That meant **the entire payout path was unreachable**
 * (a developer could neither register a payout account nor request a payout)
 * and **GDPR erasure was impossible for both roles**.
 *
 * Verified against a live production API: the server side is correct —
 * `POST /auth/step-up` issues a token for a 2FA-enabled user, and the same
 * payout-method call that returned 403 returns 201 once the header is present.
 * The defect was entirely client-side.
 *
 * HOW IT WORKS
 * ------------
 * `stepUpHandler` is installed once by the provider component. When a request
 * fails with the step-up 403, the interceptor asks the handler for a TOTP code,
 * exchanges it at `/auth/step-up` for a 5-minute action-scoped token, and
 * retries the original request with the header attached.
 *
 * Tokens are deliberately NOT cached: they are action-scoped and short-lived by
 * design, and caching one would weaken the "prove MFA at the moment of the
 * sensitive action" property the guard exists to provide.
 */

/** Maps a failed request to the step-up action the API expects. */
export function stepUpActionFor(method: string, url: string): string | null {
  const m = method.toUpperCase();
  const path = url.replace(/^\/api/, '').split('?')[0];
  if (path.startsWith('/payout/method')) return 'payout:method';
  if (path.startsWith('/payout/request')) return 'payout:request';
  if (path.startsWith('/developer/api-keys') && m === 'POST') return 'api_key:create';
  if (path.startsWith('/developer/delete-account')) return 'account:delete';
  if (path.startsWith('/advertiser/delete-account')) return 'account:delete';
  if (path.startsWith('/auth/2fa/disable')) return '2fa:disable';
  return null;
}

/** True when a response is the guard's "you need a step-up token" refusal. */
export function isStepUpRequired(status: number, message: unknown): boolean {
  if (status !== 403) return false;
  const text = Array.isArray(message) ? message.join(' ') : String(message ?? '');
  return /step-up authentication is required/i.test(text);
}

/**
 * Supplies a TOTP code for a pending step-up, or null to abort.
 * Installed by `StepUpProvider`; unset outside the authenticated app shell.
 */
export type StepUpPrompt = (action: string) => Promise<string | null>;

let prompt: StepUpPrompt | null = null;

export function setStepUpPrompt(next: StepUpPrompt | null): void {
  prompt = next;
}

export function getStepUpPrompt(): StepUpPrompt | null {
  return prompt;
}

/**
 * Human-readable description of each action, shown in the prompt so the user
 * knows what they are authorising rather than typing a code into an unexplained
 * dialog.
 */
export const STEP_UP_LABELS: Record<string, string> = {
  'payout:method': 'add or remove a payout account',
  'payout:request': 'request a payout',
  'api_key:create': 'create an API key',
  'account:delete': 'permanently delete this account',
  '2fa:disable': 'disable two-factor authentication',
};

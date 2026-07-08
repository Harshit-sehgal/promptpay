import { Logger } from '@nestjs/common';

const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_CALL_TIMEOUT_MS ?? 15_000);

/**
 * Run `fn` with a hard timeout. If the underlying call (an external PSP
 * network request) does not settle within `ms`, reject so the caller can
 * treat it as a failure instead of hanging the cron loop / payout thread.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  label: string,
  ms: number = PROVIDER_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

/**
 * Minimal per-key circuit breaker for external provider calls.
 *
 * After `FAILURE_THRESHOLD` consecutive failures for a key (e.g. a PSP
 * provider), the breaker "opens" for `COOLDOWN_MS` — calls fail fast with a
 * clear error instead of hammering an already-unhealthy dependency. After the
 * cooldown it allows a single trial (half-open); success resets the breaker.
 */
export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>();
  private readonly logger = new Logger(CircuitBreaker.name);

  private readonly FAILURE_THRESHOLD = 5;
  private readonly COOLDOWN_MS = 60_000;

  async call<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = this.states.get(key) ?? { failures: 0, openedAt: null };

    if (state.openedAt !== null) {
      const elapsed = Date.now() - state.openedAt;
      if (elapsed < this.COOLDOWN_MS) {
        throw new Error(`Circuit breaker for "${key}" is open (cooldown ${Math.ceil((this.COOLDOWN_MS - elapsed) / 1000)}s remaining)`);
      }
      // Half-open: allow one trial.
      state.openedAt = null;
    }

    try {
      const result = await fn();
      // Success resets the breaker.
      this.states.set(key, { failures: 0, openedAt: null });
      return result;
    } catch (err) {
      state.failures += 1;
      if (state.failures >= this.FAILURE_THRESHOLD) {
        state.openedAt = Date.now();
        this.logger.warn(
          `Circuit breaker for "${key}" opened after ${state.failures} consecutive failures`,
        );
      }
      this.states.set(key, state);
      throw err;
    }
  }
}

/** Shared per-provider breaker instance for PSP calls. */
export const providerBreaker = new CircuitBreaker();

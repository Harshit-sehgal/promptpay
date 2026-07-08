import { Injectable, Logger } from '@nestjs/common';

type Handler = (payload: unknown) => unknown | Promise<unknown>;

/**
 * Lightweight in-process event bus.
 *
 * Decouples event producers (e.g. the Stripe webhook receiver) from
 * asynchronous consumers (e.g. ledger/fraud reconciliation) without pulling
 * in a broker. `dispatch` is synchronous (awaits handlers) to preserve prior
 * inline behaviour; `dispatchAsync` fires handlers on the next tick so the
 * HTTP request can return 200 immediately while work continues off-thread.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** Synchronous dispatch — awaits every handler (default behaviour). */
  async dispatch(event: string, payload: unknown): Promise<void> {
    await this.runHandlers(event, payload);
  }

  /** Fire-and-forget — handlers run after the current tick. */
  dispatchAsync(event: string, payload: unknown): void {
    setImmediate(() => {
      void this.runHandlers(event, payload).catch((err) => {
        this.logger.error(
          `EventBus handler for "${event}" failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    });
  }

  private async runHandlers(event: string, payload: unknown): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      await handler(payload);
    }
  }
}

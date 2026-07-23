export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

/** Simple, dependency-free structured logger.
 *
 * In production it emits JSON lines suitable for a log aggregator.
 * In development it emits human-readable prefixed messages.
 *
 * It intentionally uses only console.* APIs so it runs in both the Node
 * and Edge runtimes used by Next.js Route Handlers without adding any
 * network or disk overhead.
 */
export class Logger {
  constructor(private readonly service: string) {}

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /** Convenience helper to log a caught error object with its stack in dev. */
  fromError(message: string, err: unknown): void {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.error(message, { error, ...(stack ? { stack } : {}) });
  }

  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      const output = { level, service: this.service, message, context };
      switch (level) {
        case 'error':
          console.error(JSON.stringify(output));
          break;
        case 'warn':
          console.warn(JSON.stringify(output));
          break;
        default:
          console.log(JSON.stringify(output));
      }
    } else {
      const ctx = Object.keys(context).length > 0 ? ' ' + JSON.stringify(context) : '';
      const formatted = `[${level.toUpperCase()}] ${this.service}: ${message}${ctx}`;
      switch (level) {
        case 'error':
          console.error(formatted);
          break;
        case 'warn':
          console.warn(formatted);
          break;
        default:
          console.log(formatted);
      }
    }
  }
}

export const logger = new Logger('waitlayer-web');

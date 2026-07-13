import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Injectable, NestMiddleware } from '@nestjs/common';

/**
 * Stamps every inbound request with an `x-request-id` header and echoes it
 * back on the response, so the client, the access log (LoggingInterceptor),
 * and the error log (HttpExceptionFilter) share one correlation id.
 *
 * Registered via `AppModule.configure()` (Nest's MiddlewareConsumer) so all
 * request middleware is declared in one place rather than scattered as ad-hoc
 * `app.use()` calls in main.ts.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers['x-request-id'];
    const incoming = typeof header === 'string' ? header.trim() : undefined;
    // Request ids flow into access/error logs and response headers. Accept a
    // deliberately small opaque alphabet only; control characters, spaces,
    // comma-joined duplicate headers, and oversized values are replaced with
    // a server UUID instead of enabling log/header injection or high-cardinality
    // telemetry abuse.
    const requestId = incoming && /^[A-Za-z0-9_-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    req.headers['x-request-id'] = requestId;
    try {
      res.setHeader('x-request-id', requestId);
    } catch {
      // best-effort
    }
    next();
  }
}

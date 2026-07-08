import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

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
    const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
    const requestId = incoming || randomUUID();
    req.headers['x-request-id'] = requestId;
    try {
      res.setHeader('x-request-id', requestId);
    } catch {
      // best-effort
    }
    next();
  }
}

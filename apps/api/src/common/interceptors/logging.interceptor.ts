import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';

import { redactUrl } from '../utils/sentry-scrubber';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method } = request;
    const url = redactUrl(request.url ?? request.originalUrl ?? '');
    // Echo the request-scoped id stamped by the requestId middleware in
    // main.ts. The HttpExceptionFilter uses the same id in its 5xx log line
    // and the JSON `requestId` field, so the access log, the error stack
    // trace, and the client-visible response all share one correlation id.
    const requestId = (request.headers?.['x-request-id'] as string | undefined) || '-';
    const now = Date.now();
    const isJson = process.env.NODE_ENV === 'production';

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        const durationMs = Date.now() - now;
        if (isJson) {
          this.logger.log(
            JSON.stringify({
              type: 'request',
              method,
              url,
              statusCode,
              durationMs,
              requestId,
            }),
          );
        } else {
          this.logger.log(
            `${method} ${url} ${statusCode} - ${durationMs}ms - requestId=${requestId}`,
          );
        }
      }),
      catchError((err: unknown) => {
        const status = (err as { status?: unknown }).status;
        const statusCode = typeof status === 'number' ? status : HttpStatus.INTERNAL_SERVER_ERROR;
        const durationMs = Date.now() - now;
        // Access logs must not carry raw error messages: Prisma/Axios errors
        // can echo query parameters, headers, or request bodies. The dedicated
        // exception filters log sanitized diagnostics under the same requestId.
        if (isJson) {
          this.logger.error(
            JSON.stringify({
              type: 'request_error',
              method,
              url,
              statusCode,
              durationMs,
              requestId,
            }),
          );
        } else {
          this.logger.error(
            `${method} ${url} ${statusCode} - ${durationMs}ms - requestId=${requestId}`,
          );
        }
        return throwError(() => err);
      }),
    );
  }
}

export { redactUrl } from '../utils/sentry-scrubber';

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

import { getErrorMessage } from '../utils/errors';

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
        if (isJson) {
          this.logger.error(
            JSON.stringify({
              type: 'request_error',
              method,
              url,
              statusCode,
              durationMs,
              requestId,
              message: getErrorMessage(err),
            }),
          );
        } else {
          this.logger.error(
            `${method} ${url} ${statusCode} - ${durationMs}ms - requestId=${requestId} - ${getErrorMessage(err)}`,
          );
        }
        return throwError(() => err);
      }),
    );
  }
}

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'code',
  'signature',
  'password',
  'secret',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
]);

/**
 * Redact sensitive query parameters from a URL before logging.
 * Preserves the origin, path and non-sensitive query params; replaces any
 * sensitive value with `[redacted]`. Works on both full URLs and
 * path+query strings. On parse failure, falls back to a best-effort regex
 * that scrubs the entire query string to avoid leaking secrets.
 */
function redactUrl(raw: string): string {
  try {
    const parsed = new URL(raw, 'http://localhost');
    let changed = false;
    parsed.searchParams.forEach((_value, key) => {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[redacted]');
        changed = true;
      }
    });
    if (!changed) return raw;
    // For absolute URLs, preserve the origin; for path-only strings, drop it.
    const isAbsolute = /^https?:\/\//i.test(raw);
    const origin = isAbsolute ? `${parsed.origin}` : '';
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Fallback: if the URL is malformed, scrub the query string entirely
    // rather than risk logging sensitive params.
    return raw.includes('?') ? raw.replace(/\?.*$/, '?[redacted]') : raw;
  }
}

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { getErrorMessage } from '../utils/errors';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    // Echo the request-scoped id stamped by the requestId middleware in
    // main.ts. The HttpExceptionFilter uses the same id in its 5xx log line
    // and the JSON `requestId` field, so the access log, the error stack
    // trace, and the client-visible response all share one correlation id.
    const requestId = (request.headers?.['x-request-id'] as string | undefined) || '-';
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        this.logger.log(`${method} ${url} ${statusCode} - ${Date.now() - now}ms - requestId=${requestId}`);
      }),
      catchError((err: unknown) => {
        const status = (err as { status?: unknown }).status;
        const statusCode = typeof status === 'number' ? status : HttpStatus.INTERNAL_SERVER_ERROR;
        this.logger.error(
          `${method} ${url} ${statusCode} - ${Date.now() - now}ms - requestId=${requestId} - ${getErrorMessage(err)}`,
        );
        return throwError(() => err);
      }),
    );
  }
}

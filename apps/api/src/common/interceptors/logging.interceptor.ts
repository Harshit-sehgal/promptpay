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
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        this.logger.log(`${method} ${url} ${statusCode} - ${Date.now() - now}ms`);
      }),
      catchError((err: unknown) => {
        const status = (err as { status?: unknown }).status;
        const statusCode = typeof status === 'number' ? status : HttpStatus.INTERNAL_SERVER_ERROR;
        this.logger.error(
          `${method} ${url} ${statusCode} - ${Date.now() - now}ms - ${getErrorMessage(err)}`,
        );
        return throwError(() => err);
      }),
    );
  }
}

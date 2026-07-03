import * as crypto from 'crypto';
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';
    const requestId = crypto.randomUUID();

    // Log 5xx errors with the full stack — these are unexpected failures that
    // need investigation. 4xx errors are client mistakes and are already logged
    // by the LoggingInterceptor.
    if (status >= 500) {
      this.logger.error(
        `Unhandled exception (requestId=${requestId}): ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }

    // If headers were already sent (e.g. streaming response), we can't write
    // a JSON body — delegate to Express's default error handler.
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(status).json({
      statusCode: status,
      message: getExceptionMessage(message),
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}

function getExceptionMessage(message: unknown): unknown {
  if (typeof message === 'string') return message;
  const nested = (message as { message?: unknown })?.message;
  return nested ?? message;
}

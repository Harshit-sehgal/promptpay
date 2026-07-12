import { Response } from 'express';
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

/**
 * Maps Prisma known-request errors to HTTP exceptions with safe, generic
 * messages. This filter runs before the catch-all `HttpExceptionFilter` so
 * database internals (table names, constraint names, etc.) never reach the
 * client.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter<Prisma.PrismaClientKnownRequestError> {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const requestId = (request.headers?.['x-request-id'] as string | undefined) || 'unknown';

    const { status, message } = this.mapError(exception);

    this.logger.error(
      `Prisma error (requestId=${requestId}, code=${exception.code}): ${exception.message}`,
    );

    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: this.errorName(status),
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private mapError(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
  } {
    switch (exception.code) {
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: 'Resource already exists' };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Resource not found' };
      case 'P2034':
      case 'P2038':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database contention — please retry',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    }
  }

  private errorName(status: number): string {
    switch (status) {
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'Service Unavailable';
      default:
        return 'Internal Server Error';
    }
  }
}

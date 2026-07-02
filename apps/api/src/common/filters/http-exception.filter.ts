import * as crypto from 'crypto';
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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

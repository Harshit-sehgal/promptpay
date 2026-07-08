import * as crypto from 'crypto';
import { Request,Response } from 'express';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';
    // Reuse the request-scoped id stamped by the requestId middleware in
    // main.ts so the filter's log line + JSON response match the
    // LoggingInterceptor's access log — operators can correlate a client's
    // `requestId` to both the access log and the 5xx stack trace. Fall back
    // to a fresh UUID if the header is somehow absent (e.g. non-HTTP RPC).
    const requestId = (request.headers['x-request-id'] as string | undefined) || crypto.randomUUID();

    // Log 5xx errors with the full stack — these are unexpected failures that
    // need investigation. 4xx errors are client mistakes and are already logged
    // by the LoggingInterceptor (which also echoes the same requestId).
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

    // Always echo the requestId in the response header so the client/upstream
    // can correlate even when the body is consumed elsewhere.
    response.setHeader('x-request-id', requestId);

    const errorProp = typeof message === 'object' && message !== null
      ? (message as { error?: string })?.error
      : undefined;

    response.status(status).json({
      statusCode: status,
      message: getExceptionMessage(message),
      error: errorProp || (status >= 500 ? 'Internal Server Error' : undefined),
      // Forward a small allowlist of structured challenge hints so clients
      // (web, CLI, VS Code) can drive multi-step auth flows without parsing
      // free-text messages. Only well-known contract fields are surfaced.
      ...getPassthroughFields(message),
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}

// Fields an exception response may carry that clients rely on for flow
// control (e.g. a 2FA challenge). These are explicitly allowlisted so the
// error envelope stays stable and we never leak arbitrary server internals.
const PASSTHROUGH_FIELDS = ['twoFactorRequired'] as const;

function getPassthroughFields(message: unknown): Record<string, unknown> {
  if (typeof message !== 'object' || message === null) return {};
  const out: Record<string, unknown> = {};
  for (const key of PASSTHROUGH_FIELDS) {
    const value = (message as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function getExceptionMessage(message: unknown): unknown {
  if (typeof message === 'string') return message;
  const nested = (message as { message?: unknown })?.message;
  return nested ?? message;
}

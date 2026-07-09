import { Request } from 'express';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

interface RequestWithOptionalApiKey extends Request {
  apiKey?: unknown;
}

/**
 * Rejects requests authenticated with a machine API key. Used on
 * self-service privacy/erasure endpoints (advertiser export/delete, A-037)
 * that must remain JWT-only even though their controller is otherwise
 * `@AllowApiKey()`. A long-lived `advertiser:write` key must never be able to
 * export or erase an account.
 */
@Injectable()
export class RejectApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithOptionalApiKey>();
    if (req.apiKey) {
      throw new ForbiddenException(
        'This endpoint requires user-session authentication and cannot be called with an API key',
      );
    }
    return true;
  }
}

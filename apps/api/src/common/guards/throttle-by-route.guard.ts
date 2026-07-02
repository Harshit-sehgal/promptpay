import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { RequestLike } from './brute-force.guard';

@Injectable()
export class ThrottleByRouteGuard extends ThrottlerGuard {
  protected override async getTracker(req: RequestLike): Promise<string> {
    const forwarded = req.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = req.ip ?? forwardedIp?.split(',')[0]?.trim() ?? req.connection?.remoteAddress ?? 'unknown';
    return `ip:${ip}`;
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    const req = context.switchToHttp().getRequest<RequestLike>();
    const path = req.route?.path ?? req.url ?? '';

    const throttleName = resolveThrottleName(path);

    // Only enforce this throttler if it matches the route's category
    const expectedName = throttler.name ?? 'default';

    if (expectedName !== throttleName) {
      return true; // let the matching throttler handle it
    }

    return super.handleRequest(requestProps);
  }
}

function resolveThrottleName(path: string): string {
  if (path.includes('/auth/login') || path.includes('/auth/signup') || path.includes('/auth/password')) {
    return 'auth-short';
  }
  if (path.includes('/auth/refresh')) {
    return 'auth-long';
  }
  if (path.includes('/extension')) {
    return 'extension';
  }
  return 'default';
}

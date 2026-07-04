import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { RequestLike } from './brute-force.guard';

@Injectable()
export class ThrottleByRouteGuard extends ThrottlerGuard {
  protected override async getTracker(req: RequestLike): Promise<string> {
    // req.ip is Express's resolved client IP (honours the `trust proxy`
    // setting in main.ts). Avoid reading x-forwarded-for directly — an
    // attacker can rotate that header per request and defeat the rate limit.
    const ip = req.ip ?? req.connection?.remoteAddress ?? 'unknown';
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
  // All credential-bearing auth routes share the tightest bucket (10/min).
  // `/auth/google` was previously falling through to `default` (200/min) —
  // a credential-stuffing vector where many OAuth token attempts could be
  // replayed against the verifier without throttling. `/auth/verify-email/*`
  // was also uncovered — verification tokens are short random strings that
  // must not be brute-forced.
  if (
    path.includes('/auth/login') ||
    path.includes('/auth/signup') ||
    path.includes('/auth/password') ||
    path.includes('/auth/google') ||
    path.includes('/auth/verify-email')
  ) {
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

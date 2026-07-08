import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

/**
 * Sets Cache-Control headers on API responses.
 *
 * Authenticated/mutating responses default to `no-store` so credentials and
 * money-movement state are never cached by intermediaries or the browser. The
 * public health probe is allowed a short `public` cache so load balancers and
 * uptime checks don't stampede the API, and the Swagger docs are cached
 * briefly for the same reason. All other routes are `no-store`.
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<{
      setHeader: (k: string, v: string) => void;
    }>();

    const req = context.switchToHttp().getRequest<{ url?: string }>();
    const url = req.url ?? '';

    let directive = 'no-store';
    if (url.startsWith('/health') || url.startsWith('/docs') || url.startsWith('/docs-json')) {
      directive = 'public, max-age=5';
    }

    try {
      response.setHeader('Cache-Control', directive);
    } catch {
      // best-effort
    }

    return next.handle().pipe(map((data) => data));
  }
}

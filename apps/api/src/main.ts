import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { raw, json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { loadEnv } from '@waitlayer/config';

async function bootstrap() {
  // Validate env on startup. Non-production environments allow
  // shorter secrets during iterative development.
  const env = loadEnv(process.env);

  const app = await NestFactory.create(AppModule);

  // ── Body-parser size limits ─────────────────────────────────────────
  //    NestJS's default body-parser caps JSON at 100kb, but that default
  //    is implicit and the Stripe webhook `raw()` mount (below) had no
  //    limit (potentially unbounded). An attacker submitting a large JSON
  //    body to any non-webhook route could amplify IO/CPU before the
  //    throttle guard reacts. Pin explicit limits so the cap is enforced
  //    and visible: 100kb for general JSON, 256kb for Stripe webhooks,
  //    100kb for urlencoded. These mount before Nest's own body-parser
  //    would otherwise engage with the implicit default.
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ limit: '100kb', extended: true }));

  // ── Cookie parser — needed for httpOnly access_token cookie from the
  //    web app's Next.js Route Handlers (express middleware). Place BEFORE
  //    Helmet so cookies are parsed before any security header decisions. ──
  app.use(cookieParser());

  // ── Request-scoped correlation id ─────────────────────────────
  // Stamp every inbound request with an `x-request-id` header (reuse a
  // caller-supplied one if present, else mint a fresh UUID). The LoggingInterceptor
  // (access log) and HttpExceptionFilter (5xx stack trace + JSON response)
  // both read this so an operator can correlate a client-visible requestId
  // across the access log, the error log, and the response body/header.
  app.use((req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
    req.headers['x-request-id'] = incoming || crypto.randomUUID();
    next();
  });

  // ── Security headers (Helmet) ──────────────────────────────────
  app.use(helmet());

  // ── Trust proxy — resolve client IP from x-forwarded-for ──────
  // Behind NGINX/LB, `req.ip` returns the proxy IP unless we tell
  // Express how many hops to trust. Set via validated TRUST_PROXY_HOPS
  // (default 1 — correct for a single reverse proxy, max 3 to avoid
  // over-trusting client-supplied X-Forwarded-For). This powers per-IP
  // brute-force tracking and rate limiting.
  const trustProxyHops = Number.isFinite(env.TRUST_PROXY_HOPS)
    ? Math.min(3, Math.max(0, Math.trunc(env.TRUST_PROXY_HOPS)))
    : 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  // Raw body parsing for the Stripe webhook route — Stripe needs the raw
  // request body for signature verification. Applied BEFORE the global
  // prefix so the path matches the effective route. Only one Stripe webhook
  // controller exists (POST /api/v1/payout/stripe/webhook) — the duplicate
  // orphan controller at /api/v1/webhooks/stripe was removed.
  app.use('/api/v1/payout/stripe/webhook', raw({ type: 'application/json', limit: '256kb' }));

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    // In production WEB_BASE_URL is validated to be a concrete origin (not
    // '*') by @waitlayer/config. With credentials: true, a single explicit
    // origin is required; reflect only that origin.
    origin: env.WEB_BASE_URL,
    credentials: true,
  });

  await app.listen(env.API_PORT);
  console.log(`🚀 WaitLayer API running on http://localhost:${env.API_PORT}`);
}

bootstrap();

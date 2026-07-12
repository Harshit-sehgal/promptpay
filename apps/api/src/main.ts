// Sentry instrument MUST be the first import — it hooks Node.js internals
// before any module is loaded so all spans and errors are captured correctly.
import cookieParser from 'cookie-parser';
import { json, raw, urlencoded } from 'express';
import helmet from 'helmet';
import './instrument';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

import { loadEnv } from '@waitlayer/config';

import { AppModule } from './app.module';

// BigInt values cannot be serialized by JSON.stringify by default. Every
// monetary column in the schema is stored as BigInt, so without this polyfill
// any response containing an amount would throw at runtime. We serialize
// BigInt as a string to preserve precision across the wire; callers that need
// numeric values should parse with BigInt(value) on the client.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { verifyMigrationsApplied } from './config/migration-check';
import { PrismaService } from './config/prisma.service';

async function bootstrap() {
  // Validate env on startup. Non-production environments allow
  // shorter secrets during iterative development.
  const env = loadEnv(process.env);

  const app = await NestFactory.create(AppModule);

  // Raw body parsing for the Stripe webhook route — Stripe needs the raw
  // request body for signature verification. Mount this before general JSON
  // parsing so the webhook body is not consumed as an object first.
  app.use('/api/v1/payout/stripe/webhook', raw({ type: 'application/json', limit: '256kb' }));

  // ── Body-parser size limits ─────────────────────────────────────────
  //    NestJS's default body-parser caps JSON at 100kb, but that default
  //    is implicit and an unbounded Stripe webhook `raw()` mount would have no
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

  // Global prefix is `api`; URI versioning (below) contributes the `/v1`
  // (or `/v2` …) segment, so the resolved base path is `/api/v1` for the
  // default version and `/api/v2` for a future major version — matching the
  // documented client contract (web proxy base, CLI PRODUCTION_API_URL). A
  // prefix of `api/v1` here would double up with the version segment and
  // produce `/api/v1/v1/...`, which 404s every real client request.
  app.setGlobalPrefix('api');
  // API versioning (URI strategy). Controllers without an explicit @Version
  // bind to defaultVersion '1', so the resolved path is `/api/v1/<resource>`
  // and new major versions can be introduced as `/api/v2/...` without
  // breaking existing clients.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(
    new SentryGlobalFilter(),
    new PrismaExceptionFilter(),
    new HttpExceptionFilter(),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    // In production WEB_BASE_URL is validated to be a concrete origin (not
    // '*') by @waitlayer/config. With credentials: true, a single explicit
    // origin is required; reflect only that origin.
    origin: env.WEB_BASE_URL,
    credentials: true,
  });

  // Wire NestJS shutdown hooks so modules implementing OnApplicationShutdown
  // (BruteForceGuard, RetentionCronService, SessionCleanupCronService) get a
  // final pass on SIGTERM/SIGINT. Without this, Docker stop / kubectl
  // stops SIGKILL after the default 10s, leaking the brute-force in-memory
  // tracker, the cleanup interval, and any open Redis connection.
  app.enableShutdownHooks();

  // Detect unapplied migrations before serving traffic. In production this
  // fails fast; in development it logs a warning (A-012).
  const prisma = app.get(PrismaService);
  try {
    await verifyMigrationsApplied(prisma);
  } catch (err) {
    console.error('[WaitLayer] Migration check failed:', err);
    throw err;
  }

  // ── OpenAPI / Swagger docs ───────────────────────────────
  // Machine-readable API contract + interactive UI at /api/v1/docs. This is
  // read-only documentation; it never alters requests. Useful for the web,
  // CLI, and (future) external developer clients.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('WaitLayer API')
    .setDescription('Privacy-first reward marketplace for AI wait time and developer attention')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(undefined, 'X-Api-Key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(env.API_PORT);
  console.log(`🚀 WaitLayer API running on http://localhost:${env.API_PORT}`);
}

// Surface unhandled failures explicitly and then fail fast. Registering these
// handlers changes Node's default behavior; if we only logged here the process
// would keep running after an unknown-corrupted state. In a financial app,
// preserving the stack in logs is useful, but continuing is not.
process.on('unhandledRejection', (reason) => {
  console.error('[WaitLayer] Unhandled promise rejection:', reason);
  setImmediate(() => {
    throw reason instanceof Error ? reason : new Error(String(reason));
  });
});
process.on('uncaughtException', (err) => {
  console.error('[WaitLayer] Uncaught exception:', err);
  process.exit(1);
});

bootstrap();

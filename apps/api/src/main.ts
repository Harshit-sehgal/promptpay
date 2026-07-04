import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { raw } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { loadEnv } from '@waitlayer/config';

async function bootstrap() {
  // Validate env on startup. Non-production environments allow
  // shorter secrets during iterative development.
  const env = loadEnv(process.env);

  const app = await NestFactory.create(AppModule);

  // ── Security headers (Helmet) ──────────────────────────────────
  app.use(helmet());

  // ── Trust proxy — resolve client IP from x-forwarded-for ──────
  // Behind NGINX/LB, `req.ip` returns the proxy IP unless we tell
  // Express how many hops to trust. Set TRUST_PROXY_HOPS in env
  // (default 1 — correct for a single reverse proxy).
  // Express also accepts `true` / IP / CIDR / arrays; a single
  // integer hop-count is the simplest secure default.
  // This powers per-IP brute-force tracking and rate limiting.
  const trustProxy = process.env.TRUST_PROXY_HOPS;
  app.getHttpAdapter().getInstance().set(
    'trust proxy',
    trustProxy ? parseInt(trustProxy, 10) || 1 : 1,
  );

  // Raw body parsing for Stripe webhook routes — Stripe needs the raw
  // request body for signature verification. Applied BEFORE global prefix
  // so the path matches the effective route.
  app.use('/api/v1/payout/stripe/webhook', raw({ type: 'application/json' }));
  app.use('/api/v1/webhooks/stripe', raw({ type: 'application/json' }));

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
    origin: env.WEB_BASE_URL,
    credentials: true,
  });

  await app.listen(env.API_PORT);
  console.log(`🚀 WaitLayer API running on http://localhost:${env.API_PORT}`);
}

bootstrap();

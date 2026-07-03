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
  loadEnv(process.env);

  const app = await NestFactory.create(AppModule);

  // ── Security headers (Helmet) ──────────────────────────────────
  app.use(helmet());

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
    origin: process.env.WEB_BASE_URL || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.API_PORT || 4000;
  await app.listen(port);
  console.log(`🚀 WaitLayer API running on http://localhost:${port}`);
}

bootstrap();

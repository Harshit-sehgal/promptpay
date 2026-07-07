import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests share one Postgres database (TRUNCATE in setup),
    // so test files must not run in parallel against it.
    fileParallelism: false,
    // The HTTP suites boot the full Nest app and truncate the local Docker
    // Postgres schema in hooks. The default 10s hook timeout is too tight on
    // slower developer disks even when the suite is healthy.
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.dto.ts', '**/*.module.ts', 'main.ts'],
      thresholds: {
        lines: 60,
        functions: 50,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@waitlayer/config': path.resolve(__dirname, '../../packages/config/src'),
      '@waitlayer/db': path.resolve(__dirname, '../../packages/db/src'),
      '@waitlayer/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});

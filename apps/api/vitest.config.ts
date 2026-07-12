import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    // Integration tests share one Postgres database (TRUNCATE in setup),
    // so test files must not run in parallel against it.
    fileParallelism: false,
    // Keep one worker process for the API package. The DB-backed HTTP suites
    // mutate the same schema and their cleanup hooks can otherwise overlap
    // with the next suite's app instance.
    maxWorkers: 1,
    // The HTTP suites boot the full Nest app and truncate the local Docker
    // Postgres schema in hooks. The default 10s hook timeout is too tight on
    // slower developer disks even when the suite is healthy.
    hookTimeout: 60_000,
    // Some real HTTP tests exercise bcrypt cost 12 and Postgres writes. The
    // default 5s test timeout can abort a test while its async request is still
    // mutating shared suite state, which cascades into misleading 401s.
    testTimeout: 60_000,
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

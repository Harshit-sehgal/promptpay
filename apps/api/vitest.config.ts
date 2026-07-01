import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.dto.ts', '**/*.module.ts', 'main.ts'],
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

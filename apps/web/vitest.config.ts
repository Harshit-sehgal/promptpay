import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@waitlayer/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@waitlayer/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
});

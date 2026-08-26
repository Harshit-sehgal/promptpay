import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@ateva/agent-protocol': path.resolve(__dirname, '../../packages/agent-protocol/src'),
      '@ateva/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});

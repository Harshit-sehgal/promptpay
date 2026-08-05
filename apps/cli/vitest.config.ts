import * as path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@waitlayer/agent-protocol': path.resolve(__dirname, '../../packages/agent-protocol/src'),
      '@waitlayer/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});

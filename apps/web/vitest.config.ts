import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next.js sets `jsx: "preserve"` (SWC handles it); Vite 8 transforms via oxc,
  // which inherits that setting and leaves JSX untransformed. Force the
  // automatic JSX runtime so .tsx components imported by tests transform.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.spec.tsx', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@waitlayer/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@waitlayer/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
});

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shareapp/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@shareapp/signaling': path.resolve(__dirname, 'apps/signaling/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});

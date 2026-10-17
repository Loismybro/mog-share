import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@shareapp/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ip': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/debug': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/metrics': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

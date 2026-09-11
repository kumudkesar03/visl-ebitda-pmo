import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Two entry points, not one SPA:
 *   login.html - unauthenticated, carries the corporate identity
 *   app.html   - the authenticated shell
 *
 * Output goes to public/, which server.js serves. Everything is bundled from
 * node_modules - no CDN - because a plant network cannot be assumed to reach
 * the public internet, and the Content Security Policy blocks it anyway.
 */
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'web'),
  publicDir: resolve(__dirname, 'web/public'),
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'web/app.html'),
        login: resolve(__dirname, 'web/login.html'),
      },
      output: {
        manualChunks: {
          charts: ['chart.js', 'react-chartjs-2'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4010', changeOrigin: true } },
  },
});

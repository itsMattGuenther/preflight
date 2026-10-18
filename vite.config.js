import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // `npm run dev` runs the API in Wrangler on :8787 (scripts/dev.mjs).
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['src/**/*.test.js', 'worker/**/*.test.js'],
    environment: 'node',
  },
});

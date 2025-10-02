import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('test'),
    'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:3001'),
  },
});

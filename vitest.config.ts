import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Kept separate from vite.config.ts on purpose: vitest ships its own copy of
// Vite, and mixing the two type trees in one config file makes tsc unhappy. The
// unit tests are plain Node anyway — no React, no Electron plugin needed.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

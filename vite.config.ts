import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';
import { fileURLToPath, URL } from 'node:url';

// Set TRIZEN_WEB_ONLY=1 to run the UI in a plain browser without spawning the
// Electron window — handy for quick visual checks.
const webOnly = process.env.TRIZEN_WEB_ONLY === '1';

export default defineConfig({
  plugins: [
    react(),
    !webOnly &&
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        // Force CJS for the preload script — it is the one context Electron
        // still loads most reliably as CommonJS, regardless of package type.
        vite: {
          build: {
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: 'preload.cjs' },
            },
          },
        },
      },
    }),
    !webOnly && renderer(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // ExcelJS's default entry pulls in Node's stream module, which the
      // renderer doesn't have (nodeIntegration is off). The prebuilt browser
      // bundle is self-contained. Types still come from the package itself.
      exceljs: 'exceljs/dist/exceljs.min.js',
    },
  },
  // Electron loads the build from file://, so assets must be referenced relatively.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Keep the big third-party libraries out of the app chunk so an edit to
        // a screen doesn't invalidate 2 MB of vendor code.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          charts: ['recharts'],
          excel: ['exceljs'],
          pdf: ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
});

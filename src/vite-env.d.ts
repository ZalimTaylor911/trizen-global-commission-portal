/// <reference types="vite/client" />

import type { TrizenApi } from '../electron/preload';

declare global {
  interface Window {
    /** Injected by electron/preload.ts. Absent when running in a plain browser. */
    trizen?: TrizenApi;
  }
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};

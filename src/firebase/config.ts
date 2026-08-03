import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const requiredKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export const missingConfigKeys = requiredKeys.filter((key) => !import.meta.env[key]);

/** True when .env has not been filled in yet — the UI shows setup instructions instead of a login box. */
export const isFirebaseConfigured = missingConfigKeys.length === 0;

// Placeholders keep the SDK constructible before .env is filled in, so the app
// can render setup instructions instead of crashing on a blank config.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'not-configured',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'not-configured.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'not-configured',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'not-configured.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:0000000000000000000000',
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Keep the session across app restarts so the team isn't retyping passwords daily.
if (isFirebaseConfigured) {
  void setPersistence(auth, browserLocalPersistence).catch((error) =>
    console.error('Could not set auth persistence', error),
  );
}

/**
 * Persistent cache means the app opens with last-known figures and keeps working
 * through a dropped connection, then reconciles when it comes back. It also cuts
 * document reads, which matters on the Spark plan's daily quota.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

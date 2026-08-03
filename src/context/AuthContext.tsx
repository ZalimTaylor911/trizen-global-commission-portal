import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, isFirebaseConfigured } from '@/firebase/config';
import { usersCol, type UserRecord } from '@/firebase/collections';
import type { Actor } from '@/firebase/repository';

interface AuthState {
  user: User | null;
  profile: UserRecord | null;
  isAdmin: boolean;
  actor: Actor | null;
  loading: boolean;
  /** Set when a login succeeds but no matching `users/{uid}` document exists. */
  profileMissing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads `users/{uid}` so an edited name or avatar shows immediately. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * 'initialising' — waiting for Firebase to say whether anyone is signed in.
 * 'loading-profile' — signed in, still resolving their `users/{uid}` record.
 * The app must not render until we reach 'ready', or it flashes a dashboard
 * with no role attached.
 */
type Status = 'initialising' | 'signed-out' | 'loading-profile' | 'ready' | 'no-profile';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserRecord | null>(null);
  const [status, setStatus] = useState<Status>(
    isFirebaseConfigured ? 'initialising' : 'signed-out',
  );

  // Mirrors `profile` so the auth callback can tell a fresh sign-in from a
  // routine token refresh without depending on state it captured at subscribe.
  const resolvedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    return onAuthStateChanged(auth, async (nextUser) => {
      if (!nextUser) {
        resolvedFor.current = null;
        setUser(null);
        setProfile(null);
        setStatus('signed-out');
        return;
      }

      setUser(nextUser);

      // Firebase re-fires this on every token refresh. If we already hold this
      // user's profile, re-read quietly rather than throwing up a spinner.
      const alreadyResolved = resolvedFor.current === nextUser.uid;
      if (!alreadyResolved) setStatus('loading-profile');

      try {
        const snapshot = await getDoc(doc(usersCol, nextUser.uid));
        if (snapshot.exists()) {
          resolvedFor.current = nextUser.uid;
          setProfile({ id: snapshot.id, ...snapshot.data() } as UserRecord);
          setStatus('ready');
        } else {
          // Auth account exists but nobody has linked it to a partner yet.
          resolvedFor.current = null;
          setProfile(null);
          setStatus('no-profile');
        }
      } catch (error) {
        console.error('Could not load user profile', error);
        // A dropped connection during a refresh shouldn't eject someone who is
        // already working — only treat a failure as fatal on first resolve.
        if (alreadyResolved) {
          setStatus('ready');
          return;
        }
        resolvedFor.current = null;
        setProfile(null);
        setStatus('no-profile');
      }
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;

    const snapshot = await getDoc(doc(usersCol, current.uid));
    if (snapshot.exists()) {
      setProfile({ id: snapshot.id, ...snapshot.data() } as UserRecord);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      isAdmin: profile?.role === 'admin',
      actor: user
        ? { userId: user.uid, userName: profile?.name ?? user.email ?? 'Unknown user' }
        : null,
      loading: status === 'initialising' || status === 'loading-profile',
      profileMissing: status === 'no-profile',
      signIn,
      signOut,
      refreshProfile,
    }),
    [user, profile, status, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

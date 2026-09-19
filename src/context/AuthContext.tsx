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
import { doc, getDoc, getDocFromServer, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import { auth, isFirebaseConfigured } from '@/firebase/config';
import { usersCol, employeesCol, type UserRecord } from '@/firebase/collections';
import type { Actor } from '@/firebase/repository';

interface AuthState {
  user: User | null;
  profile: UserRecord | null;
  isAdmin: boolean;
  isEmployee: boolean;
  employeeId: string | null;
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
 * The Firestore client keeps a persistent cache per browser/device.  A role or
 * employee link changed by an administrator must come from the server when a
 * user signs in on another device; use the cache only when the device is
 * genuinely offline.
 */
async function readUserSnapshot(uid: string) {
  try {
    return await getDocFromServer(doc(usersCol, uid));
  } catch {
    return getDoc(doc(usersCol, uid));
  }
}

/**
 * Resolve the canonical employee profile id even if an older users document
 * contains a stale/null employeeId.  Employee records are linked by their
 * permanent Auth UID (and email for legacy records), so this lookup is safe and
 * works consistently across browsers and phones.
 */
async function resolveEmployeeId(uid: string, record: Omit<UserRecord, 'id'>, authEmail?: string | null) {
  if (record.role !== 'employee' || record.status === 'pending') return record.employeeId ?? null;

  if (record.employeeId) {
    try {
      const linked = await getDocFromServer(doc(employeesCol, record.employeeId));
      if (linked.exists()) {
        const employee = linked.data() as unknown as {
          userId?: string | null;
          email?: string;
          registrationStatus?: string;
        };
        const employeeEmail = employee.email?.trim().toLowerCase();
        const recordEmail = record.email?.trim().toLowerCase();
        const loginEmail = authEmail?.trim().toLowerCase();
        const belongsToLogin = employee.userId === uid
          || (employeeEmail && (employeeEmail === recordEmail || employeeEmail === loginEmail));
        // A pending shell can share the UID with the real employee profile.
        // Prefer an approved profile so a stale users.employeeId never pins a
        // device to that shell.
        if (belongsToLogin && employee.registrationStatus !== 'pending') {
          return linked.id;
        }
      }
    } catch {
      // Fall through to the UID/email lookup below.  A stale id may point to a
      // record the employee is not allowed to read.
    }
  }

  try {
    const byUid = await getDocs(query(employeesCol, where('userId', '==', uid), limit(1)));
    const firstByUid = byUid.docs.find((entry) => entry.data().registrationStatus !== 'pending') ?? byUid.docs[0];
    if (firstByUid) return firstByUid.id;
  } catch {
    // The email lookup is useful for pre-link records and is attempted next.
  }

  const email = record.email?.trim() || authEmail?.trim();
  if (email) {
    try {
      const byEmail = await getDocs(query(employeesCol, where('email', '==', email), limit(1)));
      const firstByEmail = byEmail.docs.find((entry) => entry.data().registrationStatus !== 'pending') ?? byEmail.docs[0];
      if (firstByEmail) return firstByEmail.id;
    } catch {
      // Keep the users document's value if the device is offline.
    }
  }

  return record.employeeId ?? null;
}

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
        const snapshot = await readUserSnapshot(nextUser.uid);
        if (snapshot.exists()) {
          resolvedFor.current = nextUser.uid;
          const record = snapshot.data() as Omit<UserRecord, 'id'>;
          const canonicalEmployeeId = await resolveEmployeeId(nextUser.uid, record, nextUser.email);
          const resolvedRecord = {
            id: snapshot.id,
            ...record,
            ...(record.role === 'employee' && canonicalEmployeeId ? { employeeId: canonicalEmployeeId } : {}),
          } as UserRecord;
          setProfile(resolvedRecord);
          if (record.role === 'employee' && record.status !== 'pending'
            && canonicalEmployeeId && canonicalEmployeeId !== record.employeeId) {
            // Keep the server-side link canonical for the next device too.
            // Firestore rules only permit this write when the target employee
            // profile already belongs to this Auth UID.
            try {
              await setDoc(doc(usersCol, nextUser.uid), { employeeId: canonicalEmployeeId }, { merge: true });
            } catch (linkError) {
              // Older deployed rules may not yet include the self-link repair;
              // the in-memory canonical id still keeps this session scoped.
              console.warn('Could not persist employee link repair', linkError);
            }
          }
          if (record.status === 'pending') {
            // Backfill the employee shell for registrations created before
            // automatic employee records were introduced.
            await setDoc(doc(employeesCol, nextUser.uid), {
            name: record.name, firstName: record.firstName ?? record.name.split(/\s+/)[0], lastName: record.lastName ?? record.name.split(/\s+/).slice(1).join(' '), email: record.email, userId: nextUser.uid,
              agencyId: null, agencyName: null, agencyBasisPercent: null,
              contactPhone: record.phone ?? '', allowSlipPrinting: false, compensationType: 'commission', monthlySalary: 0,
              maxCommissionPercent: 0,
              commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 0 }],
              registrationStatus: 'pending', active: false,
            }, { merge: true });
            if (record.employeeId !== nextUser.uid) {
              await setDoc(doc(usersCol, nextUser.uid), { employeeId: nextUser.uid }, { merge: true });
            }
          }
          setStatus(record.status === 'pending' ? 'no-profile' : 'ready');
        } else {
          // A Google sign-in is a registration request. Create a locked
          // pending profile automatically so the admin sees it in Settings;
          // no business data is accessible until an admin links an employee.
          const pending = {
            email: nextUser.email ?? '',
            name: nextUser.displayName ?? nextUser.email ?? 'New employee',
            role: 'employee' as const,
            partnerId: '',
            employeeId: nextUser.uid,
            status: 'pending' as const,
          };
          await setDoc(doc(usersCol, nextUser.uid), pending, { merge: true });
          await setDoc(doc(employeesCol, nextUser.uid), {
            name: pending.name,
            firstName: nextUser.displayName?.split(/\s+/)[0] ?? pending.name,
            lastName: nextUser.displayName?.split(/\s+/).slice(1).join(' ') ?? '',
            email: pending.email,
            contactPhone: '', address: '', agencyId: null, agencyName: null,
            agencyBasisPercent: null, allowSlipPrinting: false,
            compensationType: 'commission', monthlySalary: 0,
            maxCommissionPercent: 0,
            commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 0 }],
            userId: nextUser.uid, registrationStatus: 'pending', active: false,
          }, { merge: true });
          resolvedFor.current = nextUser.uid;
          setProfile({ id: nextUser.uid, ...pending });
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

    const snapshot = await readUserSnapshot(current.uid);
    if (snapshot.exists()) {
      const record = snapshot.data() as Omit<UserRecord, 'id'>;
      const canonicalEmployeeId = await resolveEmployeeId(current.uid, record, current.email);
      setProfile({
        id: snapshot.id,
        ...record,
        ...(record.role === 'employee' && canonicalEmployeeId ? { employeeId: canonicalEmployeeId } : {}),
      } as UserRecord);
      if (record.role === 'employee' && record.status !== 'pending'
        && canonicalEmployeeId && canonicalEmployeeId !== record.employeeId) {
        try {
          await setDoc(doc(usersCol, current.uid), { employeeId: canonicalEmployeeId }, { merge: true });
        } catch (linkError) {
          console.warn('Could not persist employee link repair', linkError);
        }
      }
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      isAdmin: profile?.role === 'admin',
      isEmployee: profile?.role === 'employee',
      employeeId: profile?.employeeId ?? null,
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

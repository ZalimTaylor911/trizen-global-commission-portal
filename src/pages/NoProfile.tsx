import { useAuth } from '@/context/AuthContext';
import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { usersCol } from '@/firebase/collections';

/**
 * A Firebase Auth account on its own doesn't say who someone is in the business.
 * Until an admin creates the matching `users/{uid}` record, there is no role and
 * no partner to attach earnings to, so we stop here rather than showing an empty
 * dashboard that looks like data loss.
 */
export default function NoProfile() {
  const { user, profile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(profile?.status === 'pending');
  const [error, setError] = useState<string | null>(null);

  async function requestAccess() {
    if (!user) return;
    setBusy(true); setError(null);
    try {
      await setDoc(doc(usersCol, user.uid), {
        email: user.email ?? '', name: user.displayName ?? user.email ?? 'New employee',
        role: 'employee', partnerId: '', employeeId: null, status: 'pending',
      });
      setRequested(true);
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card wide">
        <h1>{requested ? 'Registration pending approval' : 'Request employee access'}</h1>
        <p className="sub">
          You signed in as <strong>{user?.email}</strong>, but no partner record is attached to it.
        </p>

        {error && <div className="banner error">{error}</div>}
        <div className="banner info" style={{ marginBottom: 18 }}>
          {requested ? 'Your request has been sent to the administrator. Access will open after your employee profile and commission tiers are configured.' : 'Submit your Google account for administrator approval. No business data is available until approval.'}
        </div>

        <div className="field">
          <label>Your Firebase user ID</label>
          <input className="mono" readOnly value={user?.uid ?? ''} onFocus={(e) => e.target.select()} />
          <span className="help">
            Copy this and send it to the administrator — it's what links your login to your partner
            record.
          </span>
        </div>

        {!requested && <button className="btn primary" style={{ marginTop: 18, marginRight: 10 }} disabled={busy} onClick={() => void requestAccess()}>
          {busy ? 'Submitting…' : 'Request access'}
        </button>}
        <button className="btn" style={{ marginTop: 18 }} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

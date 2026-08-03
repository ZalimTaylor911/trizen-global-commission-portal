import { useAuth } from '@/context/AuthContext';

/**
 * A Firebase Auth account on its own doesn't say who someone is in the business.
 * Until an admin creates the matching `users/{uid}` record, there is no role and
 * no partner to attach earnings to, so we stop here rather than showing an empty
 * dashboard that looks like data loss.
 */
export default function NoProfile() {
  const { user, signOut } = useAuth();

  return (
    <div className="auth-screen">
      <div className="auth-card wide">
        <h1>This account isn't linked to a partner yet</h1>
        <p className="sub">
          You signed in as <strong>{user?.email}</strong>, but no partner record is attached to it.
        </p>

        <div className="banner info" style={{ marginBottom: 18 }}>
          Ask Shabbir to open <strong>Partners</strong> and link this login. He'll need the user ID
          below.
        </div>

        <div className="field">
          <label>Your Firebase user ID</label>
          <input className="mono" readOnly value={user?.uid ?? ''} onFocus={(e) => e.target.select()} />
          <span className="help">
            Copy this and send it to the administrator — it's what links your login to your partner
            record.
          </span>
        </div>

        <button className="btn" style={{ marginTop: 18 }} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  setPersistence,
} from 'firebase/auth';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { usersCol, employeesCol } from '@/firebase/collections';
import { Field } from '@/components/ui';
import { LogoHorizontal } from '@/components/Logo';
import LoginArt, { hasLoginArt } from '@/components/LoginArt';

/** Maps Firebase's error codes to something a non-technical user can act on. */
function friendlyError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Ask Shabbir to re-enable it.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No connection to Firebase. Check your internet and try again.';
    case 'auth/internal-error':
      return 'Google sign-in could not start. Confirm Google is enabled in Firebase Authentication and this website is listed under Authentication → Settings → Authorized domains.';
    default:
      return (error as Error)?.message ?? 'Could not sign in.';
  }
}

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // Unticking "remember me" keeps the session only until the app closes —
      // worth having on a machine more than one person uses.
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      await signIn(email, password);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setError(null);
    setNotice(null);

    if (!email.trim()) {
      setError('Type your email address first, then choose Forgot password.');
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice(`Check ${email.trim()} for a link to reset your password.`);
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await setPersistence(auth, browserLocalPersistence);
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await sendEmailVerification(credential.user);
      await setDoc(doc(usersCol, credential.user.uid), {
        email: email.trim(), name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), address: address.trim(),
        role: 'employee', partnerId: '', employeeId: null, status: 'pending', emailVerified: false,
      });
      await setDoc(doc(employeesCol, credential.user.uid), {
        name: `${firstName.trim()} ${lastName.trim()}`.trim(), firstName: firstName.trim(), lastName: lastName.trim(),
        email: email.trim(), contactPhone: phone.trim(), address: address.trim(), userId: credential.user.uid,
        agencyId: null, agencyName: null, agencyBasisPercent: null, allowSlipPrinting: false,
        compensationType: 'commission', monthlySalary: 0, maxCommissionPercent: 0,
        commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 0 }],
        registrationStatus: 'pending', active: false,
      });
      await signOut(auth);
      setRegistering(false);
      setNotice('Registration submitted. Check your email to verify the account. Admin approval is required before access is enabled.');
    } catch (caught) {
      setError(friendlyError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <section className="login-form-side">
          <div className="login-brand">
            {/* Sized by width: the tagline is set into the artwork at a small
                size, so the lockup needs real width before it becomes legible. */}
            <LogoHorizontal width={300} />
          </div>

          <div className="login-body">
            <h1>{registering ? 'Create your account' : 'Welcome Back!'}</h1>
            <p className="login-sub">{registering ? 'Register as a Trizen employee.' : 'Please log in to your account.'}</p>

            {error && <div className="banner error">{error}</div>}
            {notice && <div className="banner info">{notice}</div>}

            {registering ? <form className="login-form" onSubmit={handleRegister}>
              <div className="field-row"><Field label="First name"><input required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field><Field label="Last name"><input required value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field></div>
              <Field label="Email address"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Password"><input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <div className="field-row"><Field label="Phone"><input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} /></Field><Field label="Address"><input required value={address} onChange={(e) => setAddress(e.target.value)} /></Field></div>
              <button className="btn primary login-submit" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
              <button className="btn" type="button" onClick={() => setRegistering(false)}>Back to login</button>
            </form> : <form className="login-form" onSubmit={handleSubmit}>
              <Field label="Email address">
                <input
                  type="email"
                  value={email}
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="you@company.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>

              <Field label="Password">
                <div className="login-password-input">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="password-visibility"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>

              <div className="login-row">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
                <button type="button" className="link-btn" onClick={() => void handleReset()}>
                  Forgot password?
                </button>
              </div>

              <div className="login-actions">
                <button className="btn primary login-submit" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Login'}
                  {!busy && <ArrowRight size={15} />}
                </button>
                <button
                  type="button"
                  className="btn login-secondary"
                  onClick={() => { setRegistering(true); setError(null); setNotice(null); }}
                >
                  Create account
                </button>
              </div>
            </form>}
          </div>

          <p className="login-footnote">
            Freight commission &amp; finance management. Access is limited to the Trizen team.
          </p>
        </section>

        <section className="login-art">
          <LoginArt />

          {/* Only when there's no supplied artwork — otherwise the image's own
              headline and this one render on top of each other. */}
          {!hasLoginArt && (
            <div className="login-art-copy">
              <h2>Every load, every split, in one place.</h2>
              <p>
                Commission, receivables and partner balances —<br />
                worked out the moment an agency payment is recorded.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

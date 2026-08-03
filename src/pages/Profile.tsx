import { useRef, useState } from 'react';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { Camera, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/firebase/config';
import { usersCol } from '@/firebase/collections';
import { AvatarError, fileToAvatar, initialsOf } from '@/lib/avatar';
import { Banner, Card, Field, Spinner } from '@/components/ui';

/** Turns Firebase's auth error codes into something actionable. */
function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'That current password is not correct.';
    case 'auth/weak-password':
      return 'That new password is too weak — use at least six characters.';
    case 'auth/requires-recent-login':
      return 'For security, sign out and back in, then try again.';
    case 'auth/email-already-in-use':
      return 'Another account already uses that email address.';
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/operation-not-allowed':
      return 'Email changes are disabled for this project.';
    default:
      return (error as Error)?.message ?? 'Something went wrong.';
  }
}

export default function Profile() {
  const { user, profile, isAdmin, refreshProfile } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [photo, setPhoto] = useState(profile?.photo ?? '');
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user || !profile) return <Spinner label="Loading your profile…" />;

  async function pickPhoto(file: File) {
    setDetailsError(null);
    try {
      setPhoto(await fileToAvatar(file));
    } catch (caught) {
      setDetailsError(
        caught instanceof AvatarError ? caught.message : 'Could not read that image.',
      );
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function saveDetails() {
    setDetailsBusy(true);
    setDetailsError(null);
    setDetailsMessage(null);
    try {
      await updateDoc(doc(usersCol, user!.uid), {
        name: name.trim() || profile!.email,
        phone: phone.trim(),
        photo,
      } as never);
      await refreshProfile();
      setDetailsMessage('Profile updated.');
    } catch (caught) {
      setDetailsError((caught as Error).message);
    } finally {
      setDetailsBusy(false);
    }
  }

  async function changeEmail() {
    setEmailBusy(true);
    setEmailError(null);
    setEmailMessage(null);
    try {
      const credential = EmailAuthProvider.credential(user!.email ?? '', emailPassword);
      await reauthenticateWithCredential(auth.currentUser!, credential);
      // Sends a link to the new address; the change only lands once it's clicked,
      // so a typo can't lock anyone out of their account.
      await verifyBeforeUpdateEmail(auth.currentUser!, newEmail.trim());
      setEmailMessage(
        `Check ${newEmail.trim()} for a confirmation link. Your email changes once you click it.`,
      );
      setNewEmail('');
      setEmailPassword('');
    } catch (caught) {
      setEmailError(friendlyAuthError(caught));
    } finally {
      setEmailBusy(false);
    }
  }

  async function changePassword() {
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordMessage(null);

    if (nextPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.');
      setPasswordBusy(false);
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(user!.email ?? '', currentPassword);
      await reauthenticateWithCredential(auth.currentUser!, credential);
      await updatePassword(auth.currentUser!, nextPassword);
      setPasswordMessage('Password changed.');
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setPasswordError(friendlyAuthError(caught));
    } finally {
      setPasswordBusy(false);
    }
  }

  const detailsChanged =
    name !== (profile.name ?? '') ||
    phone !== (profile.phone ?? '') ||
    photo !== (profile.photo ?? '');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>My profile</h1>
          <p>
            Signed in as {user.email} · {isAdmin ? 'Administrator' : 'User'}
          </p>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card title="Details">
          {detailsError && <Banner tone="error">{detailsError}</Banner>}
          {detailsMessage && <Banner tone="info">{detailsMessage}</Banner>}

          <div className="avatar-row">
            <div className="avatar-large">
              {photo ? (
                <img src={photo} alt="" />
              ) : (
                <span>{initialsOf(name, profile.email)}</span>
              )}
            </div>
            <div className="stack">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void pickPhoto(file);
                }}
              />
              <button className="btn" onClick={() => fileInput.current?.click()}>
                <Camera size={15} />
                {photo ? 'Change picture' : 'Upload picture'}
              </button>
              {photo && (
                <button className="btn ghost small" onClick={() => setPhoto('')}>
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
              <span className="help">
                Cropped square and scaled to 128px, so it stays a few kilobytes.
              </span>
            </div>
          </div>

          <div style={{ height: 14 }} />

          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>

          <div style={{ height: 12 }} />

          <Field label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>

          <div style={{ height: 16 }} />

          <button
            className="btn primary"
            onClick={() => void saveDetails()}
            disabled={detailsBusy || !detailsChanged}
          >
            {detailsBusy ? 'Saving…' : 'Save details'}
          </button>
        </Card>

        <Card title="Email address">
          {emailError && <Banner tone="error">{emailError}</Banner>}
          {emailMessage && <Banner tone="info">{emailMessage}</Banner>}

          <p className="help" style={{ marginTop: 0 }}>
            Your sign-in email is <strong>{user.email}</strong>. Changing it sends a confirmation
            link to the new address — the change only takes effect once you click it.
          </p>

          <Field label="New email">
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </Field>

          <div style={{ height: 12 }} />

          <Field label="Current password" help="Confirms it's really you.">
            <input
              type="password"
              autoComplete="current-password"
              value={emailPassword}
              onChange={(event) => setEmailPassword(event.target.value)}
            />
          </Field>

          <div style={{ height: 16 }} />

          <button
            className="btn primary"
            onClick={() => void changeEmail()}
            disabled={emailBusy || !newEmail.trim() || !emailPassword}
          >
            {emailBusy ? 'Sending…' : 'Send confirmation link'}
          </button>
        </Card>

        <Card title="Password">
          {passwordError && <Banner tone="error">{passwordError}</Banner>}
          {passwordMessage && <Banner tone="info">{passwordMessage}</Banner>}

          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>

          <div style={{ height: 12 }} />

          <Field label="New password" help="At least six characters.">
            <input
              type="password"
              autoComplete="new-password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
            />
          </Field>

          <div style={{ height: 12 }} />

          <Field label="Confirm new password">
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>

          <div style={{ height: 16 }} />

          <button
            className="btn primary"
            onClick={() => void changePassword()}
            disabled={
              passwordBusy || !currentPassword || nextPassword.length < 6 || !confirmPassword
            }
          >
            {passwordBusy ? 'Changing…' : 'Change password'}
          </button>
        </Card>
      </div>
    </div>
  );
}

import { missingConfigKeys } from '@/firebase/config';

/**
 * Shown when .env has not been filled in. The app is useless without a Firebase
 * project, so rather than a cryptic auth error we spell out the setup.
 */
export default function Setup() {
  return (
    <div className="auth-screen">
      <div className="auth-card wide">
        <h1>Connect a Firebase project</h1>
        <p className="sub">
          The portal stores everything in Firestore. It needs a project before it can sign anyone
          in.
        </p>

        <ol>
          <li>
            Create a free project at <code>console.firebase.google.com</code>. The Spark (free) plan
            is enough for this team.
          </li>
          <li>
            In <strong>Build → Authentication</strong>, enable the{' '}
            <strong>Email/Password</strong> sign-in provider, then add one user per person who needs
            access.
          </li>
          <li>
            In <strong>Build → Firestore Database</strong>, create a database in production mode.
          </li>
          <li>
            In <strong>Project settings → General</strong>, register a <strong>Web app</strong> and
            copy its config values.
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> in the project folder and paste the
            values in:
            <pre>
{`VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abc123`}
            </pre>
          </li>
          <li>
            Publish the access rules so partners can't edit the books:
            <pre>{`firebase deploy --only firestore:rules,firestore:indexes`}</pre>
          </li>
          <li>Restart the app.</li>
        </ol>

        {missingConfigKeys.length > 0 && (
          <div className="banner error" style={{ marginTop: 20, marginBottom: 0 }}>
            <span>
              Still missing:{' '}
              {missingConfigKeys.map((key, index) => (
                <span key={key}>
                  {index > 0 && ', '}
                  <code>{key}</code>
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

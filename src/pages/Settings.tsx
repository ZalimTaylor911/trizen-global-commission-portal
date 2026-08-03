import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import {
  Building2,
  ClipboardList,
  Download,
  ExternalLink,
  Receipt,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import {
  DEFAULT_SETTINGS,
  SETTINGS_DOC_ID,
  settingsCol,
  usersCol,
  type AppSettings,
  type UserRecord,
} from '@/firebase/collections';
import { upsertWithId } from '@/firebase/repository';
import { SHIPMENT_STATUSES, PAYMENT_TERMS, paymentTermsLabel } from '@/domain/types';
import { computeNotifications } from '@/domain/notifications';
import { initialsOf } from '@/lib/avatar';
import { saveOutput } from '@/lib/export/save';
import { Banner, Card, Field, Modal, Spinner } from '@/components/ui';

export default function Settings() {
  const { actor, user } = useAuth();
  const data = useData();

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [linking, setLinking] = useState(false);

  const [restoring, setRestoring] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  const loadUsers = useCallback(async () => {
    const snapshot = await getDocs(usersCol);
    setUsers(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as UserRecord));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const snapshot = await getDoc(doc(settingsCol, SETTINGS_DOC_ID));
        if (snapshot.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...(snapshot.data() as AppSettings) });
        }
        await loadUsers();
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadUsers]);

  const notifications = useMemo(
    () =>
      computeNotifications(
        {
          shipments: data.shipments,
          agencies: data.agencies,
          partners: data.partners,
          expenses: data.expenses,
          withdrawals: data.withdrawals,
        },
        data.customers,
      ),
    [data],
  );

  /** Every alert type the engine can raise, so they can be muted even when quiet. */
  const ALERT_TYPES = [
    { id: 'overdue-invoices', label: 'Overdue invoices' },
    { id: 'due-today', label: 'Invoices due today' },
    { id: 'due-soon', label: 'Invoices due this week' },
    { id: 'awaiting-completion', label: 'Delivered loads not yet completed' },
    { id: 'awaiting-payment', label: 'Invoiced loads awaiting payment' },
    { id: 'awaiting-agency', label: 'Loads awaiting agency payment' },
    { id: 'disputes', label: 'Open claims and disputes' },
    { id: 'unlinked-customers', label: 'Loads without a customer' },
    { id: 'over-credit-limit', label: 'Customers over credit limit' },
    { id: 'negative-balances', label: 'Partners in the red' },
  ];

  async function saveSettings(next: AppSettings) {
    setSavingSettings(true);
    setError(null);
    setSettingsMessage(null);
    try {
      await setDoc(
        doc(settingsCol, SETTINGS_DOC_ID),
        {
          ...next,
          updatedAt: new Date().toISOString(),
          updatedBy: actor?.userName ?? 'Unknown',
        } as never,
        { merge: true },
      );
      setSettings(next);
      setSettingsMessage('Settings saved.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  /**
   * Client-side backup. Firestore's managed export needs the Blaze plan, so this
   * pulls the collections the app already has in memory and writes them to JSON.
   */
  async function downloadBackup() {
    setBackupMessage(null);
    try {
      const backup = {
        exportedAt: new Date().toISOString(),
        exportedBy: actor?.userName ?? 'Unknown',
        version: 1,
        settings,
        partners: data.partners,
        agencies: data.agencies,
        customers: data.customers,
        shipments: data.shipments,
        expenses: data.expenses,
        expenseCategories: data.expenseCategories,
        withdrawals: data.withdrawals,
      };

      const bytes = new TextEncoder().encode(JSON.stringify(backup, null, 2));
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await saveOutput(
        `trizen-backup-${stamp}.json`,
        bytes,
        'application/json',
        [{ name: 'JSON backup', extensions: ['json'] }],
      );
      if (result.saved) {
        setBackupMessage(
          result.filePath ? `Backup saved to ${result.filePath}` : 'Backup downloaded.',
        );
      }
    } catch (caught) {
      setError(`Backup failed: ${(caught as Error).message}`);
    }
  }

  async function inspectRestore(file: File) {
    setRestoring(true);
    setError(null);
    setBackupMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const counts = ['shipments', 'customers', 'agencies', 'partners', 'expenses', 'withdrawals']
        .map((key) => `${(parsed[key] as unknown[] | undefined)?.length ?? 0} ${key}`)
        .join(', ');

      setBackupMessage(
        `${file.name} looks valid — taken ${String(parsed.exportedAt ?? 'unknown')}, containing ${counts}. Restoring into a live database isn't something the portal does automatically; see the note below.`,
      );
    } catch {
      setError('That file is not a Trizen backup.');
    } finally {
      setRestoring(false);
      if (restoreInput.current) restoreInput.current.value = '';
    }
  }

  if (loading) return <Spinner label="Loading settings…" />;

  const partnerById = new Map(data.partners.map((partner) => [partner.id, partner]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>System configuration, user roles and backups.</p>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {settingsMessage && <Banner tone="info">{settingsMessage}</Banner>}

      <div className="section-title">Users and roles</div>
      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Linked partner</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <strong>No linked logins</strong>
                      <span>Create the account in the Firebase console, then link it here.</span>
                    </div>
                  </td>
                </tr>
              )}
              {users.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <span className="inline">
                      <span className="avatar-small">
                        {entry.photo ? (
                          <img src={entry.photo} alt="" />
                        ) : (
                          initialsOf(entry.name, entry.email)
                        )}
                      </span>
                      <strong>{entry.name || '—'}</strong>
                      {entry.id === user?.uid && <span className="badge info">You</span>}
                    </span>
                  </td>
                  <td className="muted">{entry.email || '—'}</td>
                  <td>
                    <span className={entry.role === 'admin' ? 'badge warn' : 'badge neutral'}>
                      {entry.role === 'admin' ? 'Administrator' : 'User'}
                    </span>
                  </td>
                  <td className="muted">
                    {partnerById.get(entry.partnerId)?.name ?? (
                      <span className="badge danger">Not linked</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn ghost small" onClick={() => setEditingUser(entry)}>
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Banner tone="info">
        <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Login accounts are created in the Firebase console under{' '}
          <strong>Authentication → Users</strong> — that needs a server-side key the portal doesn't
          have on the free plan. Once an account exists, add it below with its User UID.
        </span>
      </Banner>

      <div className="inline">
        <button className="btn" onClick={() => setLinking(true)}>
          <Users size={15} />
          Link a new login
        </button>
      </div>

      <div className="section-title">System preferences</div>
      <Card>
        <div className="field-row">
          <Field label="Company name" help="Shown on exported reports.">
            <input
              value={settings.companyName}
              onChange={(event) => setSettings({ ...settings, companyName: event.target.value })}
            />
          </Field>
          <Field label="Default payment terms" help="Applied to new customers.">
            <select
              value={settings.defaultPaymentTermsDays}
              onChange={(event) =>
                setSettings({ ...settings, defaultPaymentTermsDays: Number(event.target.value) })
              }
            >
              {PAYMENT_TERMS.map((term) => (
                <option key={term.days} value={term.days}>
                  {term.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Low margin warning (%)" help="Flags loads thinner than this.">
            <input
              type="number"
              min={0}
              max={100}
              value={settings.lowMarginThresholdPercent}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  lowMarginThresholdPercent: Math.max(0, Number(event.target.value)),
                })
              }
            />
          </Field>
        </div>

        <div style={{ height: 14 }} />
        <button
          className="btn primary"
          onClick={() => void saveSettings(settings)}
          disabled={savingSettings}
        >
          {savingSettings ? 'Saving…' : 'Save preferences'}
        </button>
      </Card>

      <div className="section-title">Alerts</div>
      <Card>
        <p className="help" style={{ marginTop: 0 }}>
          Choose which alerts appear on the dashboard and in the bell. Turning one off hides it for
          everyone. In-app only — email and SMS need a server, which the free plan doesn't include.
        </p>
        <div className="stack" style={{ marginTop: 12 }}>
          {ALERT_TYPES.map((alert) => {
            const muted = settings.mutedNotifications.includes(alert.id);
            const live = notifications.find((entry) => entry.id === alert.id);
            return (
              <label className="checkbox" key={alert.id}>
                <input
                  type="checkbox"
                  checked={!muted}
                  onChange={() =>
                    setSettings({
                      ...settings,
                      mutedNotifications: muted
                        ? settings.mutedNotifications.filter((id) => id !== alert.id)
                        : [...settings.mutedNotifications, alert.id],
                    })
                  }
                />
                <span>
                  {alert.label}
                  {live && <span className="badge warn" style={{ marginLeft: 8 }}>{live.count} now</span>}
                </span>
              </label>
            );
          })}
        </div>
        <div style={{ height: 14 }} />
        <button
          className="btn primary"
          onClick={() => void saveSettings(settings)}
          disabled={savingSettings}
        >
          {savingSettings ? 'Saving…' : 'Save alert settings'}
        </button>
      </Card>

      <div className="section-title">Backup and restore</div>
      <Card>
        {backupMessage && <Banner tone="info">{backupMessage}</Banner>}
        <p className="help" style={{ marginTop: 0 }}>
          Downloads every record — shipments, customers, agencies, partners, expenses and
          withdrawals — as a single JSON file. Worth doing before any bulk change.
        </p>
        <div className="inline" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => void downloadBackup()}>
            <Download size={15} />
            Download backup
          </button>
          <input
            ref={restoreInput}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspectRestore(file);
            }}
          />
          <button
            className="btn"
            onClick={() => restoreInput.current?.click()}
            disabled={restoring}
          >
            <Upload size={15} />
            {restoring ? 'Checking…' : 'Check a backup file'}
          </button>
        </div>
        <Banner tone="warning" style={{ marginTop: 14 }}>
          Restoring isn't automatic on purpose — writing a backup back over a live database would
          silently overwrite whatever has happened since. If you need one restored, send me the file
          and I'll do it deliberately.
        </Banner>
      </Card>

      <div className="section-title">Shipment workflow</div>
      <Card>
        <p className="help" style={{ marginTop: 0 }}>
          The statuses a load moves through. These are fixed because the commission and receivable
          rules key off them — <strong>Completed</strong> starts the payment clock,{' '}
          <strong>Billed</strong> records that accounting has actually invoiced the customer (and
          needs the invoice date), and <strong>Agency Paid</strong> earns the commission.
        </p>
        <div className="inline" style={{ marginTop: 12 }}>
          {SHIPMENT_STATUSES.map((status) => (
            <span
              key={status}
              className={
                status === 'Agency Paid'
                  ? 'badge success'
                  : status === 'Completed' || status === 'Billed'
                    ? 'badge warn'
                    : 'badge neutral'
              }
            >
              {status}
            </span>
          ))}
        </div>
      </Card>

      <div className="section-title">Manage elsewhere</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <SettingsLink to="/partners" icon={Users} title="Partners and commission shares" />
        <SettingsLink to="/agencies" icon={Building2} title="Agencies and commission splits" />
        <SettingsLink to="/expenses" icon={Receipt} title="Expense categories" />
        <SettingsLink to="/audit" icon={ClipboardList} title="Audit log" />
      </div>

      <div className="section-title">Security</div>
      <Card>
        <div className="partner-rows">
          <div>
            <span>Access control</span>
            <span>Firestore security rules</span>
          </div>
          <div>
            <span>Default payment terms fallback</span>
            <span>{paymentTermsLabel(settings.defaultPaymentTermsDays)}</span>
          </div>
          <div>
            <span>Audit log</span>
            <span>Append-only — nobody can edit or delete entries</span>
          </div>
        </div>
        <Banner tone="warning" style={{ marginTop: 14 }}>
          Rules live in <code>firestore.rules</code> and only take effect once deployed. After any
          change to roles or permissions, run{' '}
          <code>npx firebase deploy --only firestore:rules</code>.
        </Banner>
      </Card>

      {editingUser && (
        <UserDialog
          record={editingUser}
          partners={data.partners}
          onClose={() => setEditingUser(null)}
          onSaved={() => void loadUsers()}
        />
      )}

      {linking && (
        <UserDialog
          record={{ id: '', email: '', name: '', role: 'partner', partnerId: '' }}
          partners={data.partners}
          isNew
          onClose={() => setLinking(false)}
          onSaved={() => void loadUsers()}
        />
      )}
    </div>
  );
}

function SettingsLink({
  to,
  icon: Icon,
  title,
}: {
  to: string;
  icon: typeof Users;
  title: string;
}) {
  return (
    <Link to={to} className="settings-link">
      <Icon size={17} />
      <span>{title}</span>
      <ExternalLink size={13} />
    </Link>
  );
}

function UserDialog({
  record,
  partners,
  isNew = false,
  onClose,
  onSaved,
}: {
  record: UserRecord;
  partners: { id: string; name: string }[];
  isNew?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(record);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await upsertWithId(usersCol, draft.id.trim(), {
        email: draft.email.trim(),
        name: draft.name.trim(),
        role: draft.role,
        partnerId: draft.partnerId,
      });
      onSaved();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      narrow
      title={isNew ? 'Link a login' : `Edit ${record.name || record.email}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => void save()}
            disabled={busy || draft.id.trim().length < 6 || !draft.partnerId}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}

      {isNew && (
        <Banner tone="info">
          Create the account first in the Firebase console under{' '}
          <strong>Authentication → Users</strong>, then paste its User UID here.
        </Banner>
      )}

      <Field label="Firebase user UID" help={isNew ? undefined : 'This cannot be changed.'}>
        <input
          className="mono"
          value={draft.id}
          readOnly={!isNew}
          placeholder="e.g. 8f2Kd0PqW1XyZ…"
          onChange={(event) => setDraft({ ...draft, id: event.target.value })}
        />
      </Field>

      <Field label="Name">
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </Field>

      <Field label="Email">
        <input
          type="email"
          value={draft.email}
          onChange={(event) => setDraft({ ...draft, email: event.target.value })}
        />
      </Field>

      <Field label="Role">
        <select
          value={draft.role}
          onChange={(event) =>
            setDraft({ ...draft, role: event.target.value as UserRecord['role'] })
          }
        >
          <option value="partner">User — runs the business, can't move money</option>
          <option value="admin">Administrator — unrestricted</option>
        </select>
      </Field>

      <Field label="Linked partner" help="Whose earnings this login sees as their own.">
        <select
          value={draft.partnerId}
          onChange={(event) => setDraft({ ...draft, partnerId: event.target.value })}
        >
          <option value="">Select a partner…</option>
          {partners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partner.name}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocs } from 'firebase/firestore';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { partnersCol, usersCol, type UserRecord } from '@/firebase/collections';
import { createRecord, deleteRecord, updateRecord, upsertWithId } from '@/firebase/repository';
import { computeLedgers, validatePartnerShares } from '@/domain/engine';
import { formatCurrency, round2 } from '@/domain/money';
import { Banner, Card, ConfirmDialog, Field, Modal, Money, Spinner } from '@/components/ui';
import type { Partner } from '@/domain/types';

type Draft = Omit<Partner, 'id' | 'createdAt' | 'updatedAt'>;

const EMPTY: Draft = {
  name: '',
  email: '',
  role: 'partner',
  sharePercent: 0,
  bearsOperationalExpenses: true,
  active: true,
};

/** The team on file in SPEC.md §1 — offered as a one-click starting point. */
const DEFAULT_TEAM: Draft[] = [
  { name: 'Shabbir', email: '', role: 'admin', sharePercent: 25, bearsOperationalExpenses: true, active: true },
  { name: 'Abrar', email: '', role: 'partner', sharePercent: 25, bearsOperationalExpenses: true, active: true },
  { name: 'Muddasir', email: '', role: 'partner', sharePercent: 25, bearsOperationalExpenses: true, active: true },
  { name: 'Muzammil', email: '', role: 'partner', sharePercent: 20, bearsOperationalExpenses: false, active: true },
  { name: 'Allah', email: '', role: 'partner', sharePercent: 5, bearsOperationalExpenses: false, active: true },
];

export default function Partners() {
  const { actor } = useAuth();
  const data = useData();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Partner | null>(null);
  const [linking, setLinking] = useState<Partner | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const snapshot = await getDocs(usersCol);
      setUsers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as UserRecord));
    } catch (caught) {
      console.error('Could not load user links', caught);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const ledgers = useMemo(
    () =>
      new Map(
        computeLedgers({
          shipments: data.shipments,
          agencies: data.agencies,
          partners: data.partners,
          expenses: data.expenses,
          withdrawals: data.withdrawals,
        }).map((ledger) => [ledger.partnerId, ledger]),
      ),
    [data],
  );

  const usersByPartner = useMemo(() => {
    const map = new Map<string, UserRecord[]>();
    for (const user of users) {
      const list = map.get(user.partnerId) ?? [];
      list.push(user);
      map.set(user.partnerId, list);
    }
    return map;
  }, [users]);

  const shareTotal = round2(
    data.partners.filter((p) => p.active).reduce((sum, p) => sum + p.sharePercent, 0),
  );
  const issues = validatePartnerShares(data.partners);

  async function handleSave(draft: Draft) {
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await updateRecord(
          partnersCol,
          {
            entity: 'partner',
            label: draft.name,
            actor,
            id: editing.id,
            previous: editing as unknown as Record<string, unknown>,
          },
          draft,
        );
      } else {
        await createRecord(partnersCol, { entity: 'partner', label: draft.name, actor }, draft);
      }
      setEditing(null);
      setCreating(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting || !actor) return;
    setBusy(true);
    try {
      await deleteRecord(partnersCol, {
        entity: 'partner',
        label: deleting.name,
        actor,
        id: deleting.id,
        previous: deleting as unknown as Record<string, unknown>,
      });
      setDeleting(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function seedTeam() {
    if (!actor) return;
    setBusy(true);
    try {
      for (const member of DEFAULT_TEAM) {
        await createRecord(partnersCol, { entity: 'partner', label: member.name, actor }, member);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (data.loading) return <Spinner label="Loading partners…" />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Partners</h1>
          <p>
            Shares apply to the team's half of each shipment. Silent partners are excluded from
            operational expenses but still carry agency deductions in proportion to their share.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            New partner
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {issues.map((issue) => (
        <Banner key={issue.message} tone={issue.level === 'error' ? 'error' : 'warning'}>
          {issue.message}
        </Banner>
      ))}

      <Banner tone="info">
        Changing a share affects loads earned from now on. Anything already at{' '}
        <strong>agency payment</strong> keeps the shares it was paid under, so past balances and
        withdrawals stay as they were.
      </Banner>

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Partner</th>
                <th className="num">Share</th>
                <th>Operational expenses</th>
                <th>Role</th>
                <th>Login</th>
                <th className="num">Earned</th>
                <th className="num">Withdrawn</th>
                <th className="num">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.partners.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">
                      <strong>No partners yet</strong>
                      <span>Add each person who takes a share of the team commission.</span>
                      <div style={{ marginTop: 14 }}>
                        <button className="btn primary" onClick={() => void seedTeam()} disabled={busy}>
                          Create the five partners on file
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {data.partners.map((partner) => {
                const ledger = ledgers.get(partner.id);
                const linked = usersByPartner.get(partner.id) ?? [];
                return (
                  <tr key={partner.id}>
                    <td>
                      <strong>{partner.name}</strong>
                      {!partner.active && <span className="badge neutral" style={{ marginLeft: 8 }}>Inactive</span>}
                      {partner.email && <div className="muted">{partner.email}</div>}
                    </td>
                    <td className="num">{partner.sharePercent}%</td>
                    <td>
                      <span className={partner.bearsOperationalExpenses ? 'badge info' : 'badge neutral'}>
                        {partner.bearsOperationalExpenses ? 'Shares costs' : 'Silent'}
                      </span>
                    </td>
                    <td>
                      <span className={partner.role === 'admin' ? 'badge warn' : 'badge neutral'}>
                        {partner.role === 'admin' ? 'Admin' : 'Partner'}
                      </span>
                    </td>
                    <td>
                      {linked.length > 0 ? (
                        <span className="badge success">Linked</span>
                      ) : (
                        <span className="muted">No login</span>
                      )}
                    </td>
                    <td className="num">{formatCurrency(ledger?.totalEarned ?? 0)}</td>
                    <td className="num">{formatCurrency(ledger?.withdrawals ?? 0)}</td>
                    <td className="num">
                      <Money amount={ledger?.balance ?? 0} colour />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn ghost small"
                          onClick={() => setLinking(partner)}
                          aria-label="Link login"
                          title="Link a Firebase login"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button className="btn ghost small" onClick={() => setEditing(partner)} aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        <button className="btn ghost small" onClick={() => setDeleting(partner)} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {data.partners.length > 0 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num" style={{ color: shareTotal === 100 ? undefined : 'var(--negative)' }}>
                    {shareTotal}%
                  </td>
                  <td colSpan={7} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {(creating || editing) && (
        <PartnerForm
          initial={editing ?? EMPTY}
          isEdit={Boolean(editing)}
          otherShareTotal={round2(
            data.partners
              .filter((p) => p.active && p.id !== editing?.id)
              .reduce((sum, p) => sum + p.sharePercent, 0),
          )}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      {linking && (
        <LinkLoginDialog
          partner={linking}
          existing={usersByPartner.get(linking.id) ?? []}
          onClose={() => setLinking(null)}
          onLinked={() => void loadUsers()}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete partner"
          message={`Delete ${deleting.name}? Their historical earnings disappear from every report. Marking them inactive is usually safer.`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function PartnerForm({
  initial,
  isEdit,
  otherShareTotal,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft | Partner;
  isEdit: boolean;
  otherShareTotal: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...(initial as Draft) });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const projectedTotal = round2(otherShareTotal + (draft.active ? draft.sharePercent : 0));

  return (
    <Modal
      narrow
      title={isEdit ? 'Edit partner' : 'New partner'}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => onSave(draft)}
            disabled={busy || !draft.name.trim()}
          >
            {busy ? 'Saving…' : 'Save partner'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input value={draft.name} autoFocus onChange={(e) => set('name', e.target.value)} />
      </Field>

      <Field label="Email" help="Used for their sign-in account. Optional for silent partners.">
        <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
      </Field>

      <Field
        label="Share of team commission (%)"
        help={
          projectedTotal === 100
            ? 'All shares total 100%.'
            : `All active shares would total ${projectedTotal}%.`
        }
      >
        <input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={draft.sharePercent}
          onChange={(e) => set('sharePercent', Number(e.target.value))}
        />
      </Field>

      <Field label="Role">
        <select value={draft.role} onChange={(e) => set('role', e.target.value as Draft['role'])}>
          <option value="partner">Partner — read-only, own figures</option>
          <option value="admin">Admin — full access to everything</option>
        </select>
      </Field>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.bearsOperationalExpenses}
          onChange={(e) => set('bearsOperationalExpenses', e.target.checked)}
        />
        <span>
          <strong>Shares operational expenses</strong>
          <br />
          <span className="muted">
            Off for silent partners. They still carry agency deductions in proportion to their share.
          </span>
        </span>
      </label>

      <label className="checkbox">
        <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
        <span>
          <strong>Active</strong>
          <br />
          <span className="muted">Inactive partners stop receiving new commission.</span>
        </span>
      </label>

      {projectedTotal !== 100 && (
        <Banner tone="warning">
          Active shares would total {projectedTotal}%, not 100%. Commission is still split in
          proportion, but check the numbers.
        </Banner>
      )}
    </Modal>
  );
}

/**
 * Firebase Auth accounts are created in the Firebase console; this dialog just
 * records which account belongs to which partner, and what role it carries.
 */
function LinkLoginDialog({
  partner,
  existing,
  onClose,
  onLinked,
}: {
  partner: Partner;
  existing: UserRecord[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      await upsertWithId(usersCol, uid.trim(), {
        email: partner.email,
        name: partner.name,
        role: partner.role,
        partnerId: partner.id,
      });
      setDone(true);
      setUid('');
      onLinked();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      narrow
      title={`Link a login to ${partner.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="btn primary" onClick={() => void link()} disabled={busy || uid.trim().length < 6}>
            {busy ? 'Linking…' : 'Link account'}
          </button>
        </>
      }
    >
      <Banner tone="info">
        Create the account first in the Firebase console under{' '}
        <strong>Authentication → Users</strong>, then paste its User UID here. That's what grants
        this person the <strong>{partner.role === 'admin' ? 'admin' : 'partner'}</strong> role.
      </Banner>

      {existing.length > 0 && (
        <Field label="Already linked">
          <div className="stack">
            {existing.map((user) => (
              <div key={user.id} className="inline">
                <span className="mono">{user.id}</span>
                <span className={user.role === 'admin' ? 'badge warn' : 'badge neutral'}>{user.role}</span>
              </div>
            ))}
          </div>
        </Field>
      )}

      <Field label="Firebase user UID">
        <input
          className="mono"
          value={uid}
          placeholder="e.g. 8f2Kd0PqW1XyZ..."
          onChange={(e) => setUid(e.target.value)}
        />
      </Field>

      {error && <Banner tone="error">{error}</Banner>}
      {done && !error && <Banner tone="info">Linked. They'll get the new role next time they sign in.</Banner>}
    </Modal>
  );
}

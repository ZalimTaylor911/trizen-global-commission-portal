import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { withdrawalsCol } from '@/firebase/collections';
import { createRecord, deleteRecord } from '@/firebase/repository';
import { computeLedgers } from '@/domain/engine';
import { formatCurrency } from '@/domain/money';
import { distinctMonths, formatDate, monthLabel, monthOf, today } from '@/lib/dates';
import { Banner, Card, ConfirmDialog, EmptyState, Field, Modal, Money, Spinner } from '@/components/ui';
import type { Withdrawal } from '@/domain/types';

type Draft = Omit<Withdrawal, 'id' | 'createdAt'>;

export default function Withdrawals() {
  const { isAdmin, actor } = useAuth();
  const data = useData();

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Withdrawal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partnerFilter, setPartnerFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  const partnerById = useMemo(
    () => new Map(data.partners.map((partner) => [partner.id, partner])),
    [data.partners],
  );

  const ledgers = useMemo(
    () =>
      computeLedgers({
        shipments: data.shipments,
        agencies: data.agencies,
        partners: data.partners,
        expenses: data.expenses,
        withdrawals: data.withdrawals,
      }),
    [data],
  );

  const months = useMemo(() => distinctMonths(data.withdrawals), [data.withdrawals]);

  const filtered = useMemo(
    () =>
      data.withdrawals.filter((withdrawal) => {
        if (partnerFilter && withdrawal.partnerId !== partnerFilter) return false;
        if (monthFilter && withdrawal.month !== monthFilter) return false;
        return true;
      }),
    [data.withdrawals, partnerFilter, monthFilter],
  );

  const total = filtered.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);

  async function handleSave(draft: Draft) {
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      await createRecord(
        withdrawalsCol,
        {
          entity: 'withdrawal',
          label: `${partnerById.get(draft.partnerId)?.name ?? 'Partner'} — ${formatCurrency(
            draft.amount,
          )}`,
          actor,
        },
        draft,
      );
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
      await deleteRecord(withdrawalsCol, {
        entity: 'withdrawal',
        label: `${partnerById.get(deleting.partnerId)?.name ?? 'Partner'} — ${formatCurrency(
          deleting.amount,
        )}`,
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

  if (data.loading) return <Spinner label="Loading withdrawals…" />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Withdrawals</h1>
          <p>
            {isAdmin
              ? 'Recording a withdrawal immediately reduces that partner’s balance and the outstanding total.'
              : 'Your payment history.'}
          </p>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <button
              className="btn primary"
              onClick={() => setCreating(true)}
              disabled={data.partners.length === 0}
            >
              <Plus size={15} />
              Record withdrawal
            </button>
          </div>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {isAdmin && ledgers.length > 0 && (
        <>
          <div className="section-title">Available to withdraw</div>
          <div className="tiles">
            {ledgers.map((ledger) => (
              <div className="tile" key={ledger.partnerId}>
                <div className="label">{ledger.partnerName}</div>
                <div className={ledger.balance < 0 ? 'value negative' : 'value positive'}>
                  {formatCurrency(ledger.balance)}
                </div>
                <div className="hint">{formatCurrency(ledger.withdrawals)} withdrawn to date</div>
              </div>
            ))}
          </div>
          <div style={{ height: 8 }} />
        </>
      )}

      <div className="section-title">History</div>

      <Card>
        <div className="filters">
          {isAdmin && (
            <Field label="Partner">
              <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)}>
                <option value="">All partners</option>
                {data.partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Month">
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All months</option>
              {months.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Partner</th>
                <th className="num">Amount</th>
                <th>Notes</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4}>
                    <EmptyState
                      title="No withdrawals yet"
                      message={
                        isAdmin
                          ? 'Record a payout when a partner takes money out.'
                          : 'Nothing has been paid out to you yet.'
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.map((withdrawal) => (
                <tr key={withdrawal.id}>
                  <td className="nowrap">{formatDate(withdrawal.date)}</td>
                  <td>{partnerById.get(withdrawal.partnerId)?.name ?? <span className="muted">Unknown</span>}</td>
                  <td className="num">{formatCurrency(withdrawal.amount)}</td>
                  <td className="muted">{withdrawal.notes || '—'}</td>
                  {isAdmin && (
                    <td>
                      <div className="row-actions">
                        <button className="btn ghost small" onClick={() => setDeleting(withdrawal)} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}>{filtered.length} withdrawals</td>
                  <td className="num">{formatCurrency(total)}</td>
                  <td colSpan={isAdmin ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {creating && (
        <WithdrawalForm
          ledgers={ledgers}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete withdrawal"
          message={`Remove this ${formatCurrency(deleting.amount)} withdrawal? ${
            partnerById.get(deleting.partnerId)?.name ?? 'The partner'
          }'s balance goes back up by that amount.`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function WithdrawalForm({
  ledgers,
  busy,
  onCancel,
  onSave,
}: {
  ledgers: ReturnType<typeof computeLedgers>;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const date = today();
  const [draft, setDraft] = useState<Draft>({
    partnerId: ledgers[0]?.partnerId ?? '',
    amount: 0,
    date,
    month: monthOf(date),
    notes: '',
  });

  const ledger = ledgers.find((entry) => entry.partnerId === draft.partnerId);
  const remaining = (ledger?.balance ?? 0) - draft.amount;
  const overdrawn = draft.amount > 0 && remaining < 0;

  return (
    <Modal
      narrow
      title="Record withdrawal"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => onSave({ ...draft, month: monthOf(draft.date) })}
            disabled={busy || draft.amount <= 0 || !draft.partnerId}
          >
            {busy ? 'Saving…' : 'Record withdrawal'}
          </button>
        </>
      }
    >
      <Field label="Partner">
        <select
          value={draft.partnerId}
          onChange={(e) => setDraft((prev) => ({ ...prev, partnerId: e.target.value }))}
        >
          {ledgers.map((entry) => (
            <option key={entry.partnerId} value={entry.partnerId}>
              {entry.partnerName} — {formatCurrency(entry.balance)} available
            </option>
          ))}
        </select>
      </Field>

      <div className="field-row">
        <Field label="Amount">
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={draft.amount}
            onChange={(e) => setDraft((prev) => ({ ...prev, amount: Number(e.target.value) }))}
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={draft.date}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, date: e.target.value, month: monthOf(e.target.value) }))
            }
          />
        </Field>
      </div>

      <div className="inline">
        {[25, 50, 100].map((percent) => (
          <button
            key={percent}
            className="btn small"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                amount: Number((((ledger?.balance ?? 0) * percent) / 100).toFixed(2)),
              }))
            }
            disabled={!ledger || ledger.balance <= 0}
          >
            {percent}% of balance
          </button>
        ))}
      </div>

      <Field label="Notes">
        <textarea
          value={draft.notes}
          placeholder="Bank transfer, cash, reference number…"
          onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
        />
      </Field>

      {ledger && (
        <Card title="After this withdrawal">
          <div className="partner-rows">
            <div>
              <span>Current balance</span>
              <span>{formatCurrency(ledger.balance)}</span>
            </div>
            <div>
              <span>This withdrawal</span>
              <span>−{formatCurrency(draft.amount)}</span>
            </div>
            <div className="total">
              <span>Remaining</span>
              <Money amount={remaining} colour />
            </div>
          </div>
        </Card>
      )}

      {overdrawn && (
        <Banner tone="warning">
          This is more than {ledger?.partnerName} currently has available. It will be recorded and
          leave them with a negative balance — allowed, but worth double-checking.
        </Banner>
      )}
    </Modal>
  );
}

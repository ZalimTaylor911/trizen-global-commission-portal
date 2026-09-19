import { useMemo, useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { expenseCategoriesCol, expensesCol } from '@/firebase/collections';
import { createRecord, deleteRecord, updateRecord } from '@/firebase/repository';
import { splitExpense, operationalPartners, commissionPartners } from '@/domain/engine';
import { formatCurrency } from '@/domain/money';
import { distinctMonths, formatDate, monthLabel, monthOf, today } from '@/lib/dates';
import { Banner, Card, ConfirmDialog, EmptyState, Field, Modal, Spinner } from '@/components/ui';
import type { Expense, ExpenseCategory, ExpenseType } from '@/domain/types';

type Draft = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>;

const DEFAULT_CATEGORIES = [
  'Phone bill',
  'Internet',
  'Office rent',
  'Software',
  'Inventory',
  'Marketing',
  'Miscellaneous',
];

const DEDUCTION_CATEGORIES = ['Claim deduction', 'Billing adjustment', 'Commission correction'];

function emptyDraft(categoryId: string): Draft {
  const date = today();
  return {
    type: 'operational',
    categoryId,
    amount: 0,
    date,
    month: monthOf(date),
    notes: '',
    shipmentId: null,
  };
}

export default function Expenses() {
  const { isAdmin, actor } = useAuth();
  const data = useData();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<'' | ExpenseType>('');
  const [monthFilter, setMonthFilter] = useState('');

  const categoryById = useMemo(
    () => new Map(data.expenseCategories.map((category) => [category.id, category])),
    [data.expenseCategories],
  );

  const months = useMemo(() => distinctMonths(data.expenses), [data.expenses]);

  const filtered = useMemo(
    () =>
      data.expenses.filter((expense) => {
        if (typeFilter && expense.type !== typeFilter) return false;
        if (monthFilter && expense.month !== monthFilter) return false;
        return true;
      }),
    [data.expenses, typeFilter, monthFilter],
  );

  const totals = useMemo(() => {
    let operational = 0;
    let deductions = 0;
    let employeePayroll = 0;
    for (const expense of filtered) {
      if (expense.type === 'operational') operational += expense.amount;
      else if (expense.type === 'agency-deduction') deductions += expense.amount;
      else employeePayroll += expense.amount;
    }
    return { operational, deductions, employeePayroll, all: operational + deductions + employeePayroll };
  }, [filtered]);

  async function handleSave(draft: Draft) {
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      const label = `${categoryById.get(draft.categoryId)?.name ?? 'Expense'} — ${formatCurrency(
        draft.amount,
      )}`;
      if (editing) {
        await updateRecord(
          expensesCol,
          {
            entity: 'expense',
            label,
            actor,
            id: editing.id,
            previous: editing as unknown as Record<string, unknown>,
          },
          draft,
        );
      } else {
        await createRecord(expensesCol, { entity: 'expense', label, actor }, draft);
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
      await deleteRecord(expensesCol, {
        entity: 'expense',
        label: `${categoryById.get(deleting.categoryId)?.name ?? 'Expense'} — ${formatCurrency(
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

  if (data.loading) return <Spinner label="Loading expenses…" />;

  const opexPartners = operationalPartners(data.partners);
  const allPartners = commissionPartners(data.partners);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Expenses</h1>
          <p>
            Operational costs are split among {opexPartners.length || '—'} cost-sharing partner
            {opexPartners.length === 1 ? '' : 's'}. Agency deductions reduce the team pool and are
            split by commission share across all {allPartners.length || '—'} partners.
          </p>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <button className="btn" onClick={() => setManagingCategories(true)}>
              <Tags size={15} />
              Categories
            </button>
            <button
              className="btn primary"
              onClick={() => setCreating(true)}
              disabled={data.expenseCategories.length === 0}
            >
              <Plus size={15} />
              New expense
            </button>
          </div>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {isAdmin && data.expenseCategories.length === 0 && (
        <Banner tone="warning">
          <span>
            No expense categories yet.{' '}
            <button className="btn small" onClick={() => setManagingCategories(true)}>
              Set them up
            </button>
          </span>
        </Banner>
      )}

      <div className="tiles">
        <Tile label="Operational" value={formatCurrency(totals.operational)} />
        <Tile label="Agency deductions" value={formatCurrency(totals.deductions)} />
        <Tile label="Employee payroll" value={formatCurrency(totals.employeePayroll)} />
        <Tile label="Total" value={formatCurrency(totals.all)} accent />
      </div>

      <div style={{ height: 14 }} />

      <Card>
        <div className="filters">
          <Field label="Type">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | ExpenseType)}>
              <option value="">All types</option>
              <option value="operational">Operational</option>
              <option value="agency-deduction">Agency deduction</option>
              <option value="employee-compensation">Employee settlement</option>
            </select>
          </Field>
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
                <th>Category</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th className="num">Per partner</th>
                <th>Charged to</th>
                <th>Notes</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7}>
                    <EmptyState
                      title={data.expenses.length === 0 ? 'No expenses recorded' : 'No matches'}
                      message={
                        data.expenses.length === 0
                          ? 'Add office costs, software, or agency clawbacks here.'
                          : 'Try clearing a filter.'
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.map((expense) => {
                const split = splitExpense(expense, data.partners);
                const bearers = expense.type === 'employee-compensation'
                  ? []
                  : expense.type === 'operational' ? opexPartners : allPartners;
                const each = bearers.length > 0 ? split[bearers[0]!.id] ?? 0 : 0;
                return (
                  <tr key={expense.id}>
                    <td className="nowrap">{formatDate(expense.date)}</td>
                    <td>{categoryById.get(expense.categoryId)?.name ?? <span className="muted">Uncategorised</span>}</td>
                    <td>
                      <span className={expense.type === 'operational' ? 'badge info' : expense.type === 'employee-compensation' ? 'badge positive' : 'badge warn'}>
                        {expense.type === 'operational' ? 'Operational' : expense.type === 'employee-compensation' ? 'Employee settlement' : 'Agency deduction'}
                      </span>
                    </td>
                    <td className="num">{formatCurrency(expense.amount)}</td>
                    <td className="num">{formatCurrency(each)}</td>
                    <td className="muted">
                      {bearers.length === 0 ? '—' : bearers.map((p) => p.name).join(', ')}
                    </td>
                    <td className="muted">{expense.notes || '—'}</td>
                    {isAdmin && (
                      <td>
                        <div className="row-actions">
                          <button className="btn ghost small" onClick={() => setEditing(expense)} aria-label="Edit">
                            <Pencil size={14} />
                          </button>
                          <button className="btn ghost small" onClick={() => setDeleting(expense)} aria-label="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {(creating || editing) && (
        <ExpenseForm
          initial={editing ?? emptyDraft(data.expenseCategories[0]?.id ?? '')}
          isEdit={Boolean(editing)}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      {managingCategories && <CategoryManager onClose={() => setManagingCategories(false)} />}

      {deleting && (
        <ConfirmDialog
          title="Delete expense"
          message={`Delete this ${formatCurrency(
            deleting.amount,
          )} expense? Every affected partner's balance goes back up.`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? 'tile accent' : 'tile'}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function ExpenseForm({
  initial,
  isEdit,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft | Expense;
  isEdit: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const data = useData();
  const [draft, setDraft] = useState<Draft>({ ...(initial as Draft) });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const split = useMemo(
    () => splitExpense({ ...draft, id: 'preview' } as Expense, data.partners),
    [draft, data.partners],
  );

  const bearers = draft.type === 'operational'
    ? operationalPartners(data.partners)
    : commissionPartners(data.partners);

  return (
    <Modal
      narrow
      title={isEdit ? 'Edit expense' : 'New expense'}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => onSave({ ...draft, month: monthOf(draft.date) })}
            disabled={busy || draft.amount <= 0 || (!draft.categoryId && draft.type !== 'employee-compensation')}
          >
            {busy ? 'Saving…' : 'Save expense'}
          </button>
        </>
      }
    >
      <Field
        label="Type"
        help={
          draft.type === 'operational'
            ? 'Shared only by partners who bear operational costs.'
            : 'Shared by commission percentage, including silent partners.'
        }
      >
        <select value={draft.type} onChange={(e) => set('type', e.target.value as ExpenseType)}>
          <option value="operational">Operational expense</option>
          <option value="agency-deduction">Agency deduction</option>
        </select>
      </Field>

      <div className="field-row">
        <Field label="Category">
          <select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Select…</option>
            {data.expenseCategories
              .filter((category) => category.active || category.id === draft.categoryId)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            type="number"
            step="0.01"
            min="0"
            value={draft.amount}
            onChange={(e) => set('amount', Number(e.target.value))}
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value, month: monthOf(e.target.value) }))}
          />
        </Field>
      </div>

      {draft.type === 'agency-deduction' && (
        <Field label="Related shipment (optional)">
          <select
            value={draft.shipmentId ?? ''}
            onChange={(e) => set('shipmentId', e.target.value || null)}
          >
            <option value="">Not tied to a specific load</option>
            {data.shipments.slice(0, 200).map((shipment) => (
              <option key={shipment.id} value={shipment.id}>
                {shipment.loadNumber || '(no load #)'} — {shipment.companyName} ({formatDate(shipment.date)})
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Notes">
        <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      {draft.amount > 0 && (
        <Card title="How this is charged">
          {bearers.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No partner is set to carry this expense type, so nothing will be charged.
            </p>
          ) : (
            <div className="partner-rows">
              {data.partners
                .filter((partner) => partner.active)
                .map((partner) => (
                  <div key={partner.id}>
                    <span>{partner.name}</span>
                    <span>{formatCurrency(split[partner.id] ?? 0)}</span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}
    </Modal>
  );
}

function CategoryManager({ onClose }: { onClose: () => void }) {
  const { actor } = useAuth();
  const data = useData();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(categoryName: string) {
    if (!actor || !categoryName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createRecord(
        expenseCategoriesCol,
        { entity: 'expense-category', label: categoryName, actor },
        { name: categoryName.trim(), active: true },
      );
      setName('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function seed(names: string[]) {
    if (!actor) return;
    setBusy(true);
    try {
      const existing = new Set(data.expenseCategories.map((c) => c.name.toLowerCase()));
      for (const categoryName of names) {
        if (existing.has(categoryName.toLowerCase())) continue;
        await createRecord(
          expenseCategoriesCol,
          { entity: 'expense-category', label: categoryName, actor },
          { name: categoryName, active: true },
        );
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(category: ExpenseCategory) {
    if (!actor) return;
    try {
      await updateRecord(
        expenseCategoriesCol,
        {
          entity: 'expense-category',
          label: category.name,
          actor,
          id: category.id,
          previous: category as unknown as Record<string, unknown>,
        },
        { active: !category.active },
      );
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <Modal
      narrow
      title="Expense categories"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}

      <div className="inline" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Field label="Add a category">
            <input
              value={name}
              placeholder="e.g. Fuel card"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add(name);
              }}
            />
          </Field>
        </div>
        <button className="btn primary" onClick={() => void add(name)} disabled={busy || !name.trim()}>
          Add
        </button>
      </div>

      {data.expenseCategories.length === 0 && (
        <div className="inline">
          <button className="btn small" onClick={() => void seed(DEFAULT_CATEGORIES)} disabled={busy}>
            Add the seven standard categories
          </button>
          <button className="btn small" onClick={() => void seed(DEDUCTION_CATEGORIES)} disabled={busy}>
            Add deduction categories
          </button>
        </div>
      )}

      <div className="stack">
        {data.expenseCategories.map((category) => (
          <div key={category.id} className="inline" style={{ justifyContent: 'space-between' }}>
            <span>{category.name}</span>
            <button className="btn small" onClick={() => void toggle(category)}>
              {category.active ? 'Active' : 'Hidden'}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

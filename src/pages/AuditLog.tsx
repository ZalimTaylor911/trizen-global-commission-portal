import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AUDIT_LOG_WINDOW, useData } from '@/context/DataContext';
import { formatCurrency } from '@/domain/money';
import { formatDateTime } from '@/lib/dates';
import { Card, EmptyState, Field, Spinner } from '@/components/ui';
import type { AuditAction, AuditEntity, AuditEntry } from '@/domain/types';

const ENTITY_LABELS: Record<AuditEntity, string> = {
  shipment: 'Shipment',
  agency: 'Agency',
  partner: 'Partner',
  customer: 'Customer',
  expense: 'Expense',
  'expense-category': 'Category',
  withdrawal: 'Withdrawal',
  session: 'Session',
};

const ACTION_TONE: Record<AuditAction, string> = {
  created: 'badge success',
  updated: 'badge info',
  deleted: 'badge danger',
  'status-changed': 'badge warn',
  'signed-in': 'badge neutral',
};

/** Money fields are stored as raw numbers; render them as currency in the diff. */
const CURRENCY_FIELDS = new Set([
  'amount',
  'ar',
  'ap',
  'grossMargin',
  'netMargin',
]);

function renderValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return CURRENCY_FIELDS.has(field) ? formatCurrency(value) : String(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanField(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/\bAr\b/, 'AR')
    .replace(/\bAp\b/, 'AP')
    .replace(/\bPoc\b/, 'POC')
    .replace(/ Id$/, '')
    .trim();
}

export default function AuditLog() {
  const data = useData();
  const [entityFilter, setEntityFilter] = useState<'' | AuditEntity>('');
  const [actionFilter, setActionFilter] = useState<'' | AuditAction>('');
  const [userFilter, setUserFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const users = useMemo(
    () => [...new Set(data.auditLog.map((entry) => entry.userName))].sort(),
    [data.auditLog],
  );

  const filtered = useMemo(
    () =>
      data.auditLog.filter((entry) => {
        if (entityFilter && entry.entity !== entityFilter) return false;
        if (actionFilter && entry.action !== actionFilter) return false;
        if (userFilter && entry.userName !== userFilter) return false;
        return true;
      }),
    [data.auditLog, entityFilter, actionFilter, userFilter],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (data.loading) return <Spinner label="Loading audit log…" />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>
            Every change to the books, with what it was before and after. Entries can't be edited or
            deleted by anyone, including admins. Showing the most recent{' '}
            {AUDIT_LOG_WINDOW.toLocaleString()} — older entries stay in the database.
          </p>
        </div>
      </div>

      <Card>
        <div className="filters">
          <Field label="Record type">
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value as '' | AuditEntity)}>
              <option value="">All types</option>
              {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Action">
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as '' | AuditAction)}>
              <option value="">All actions</option>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
              <option value="status-changed">Status changed</option>
              <option value="deleted">Deleted</option>
            </select>
          </Field>
          <Field label="User">
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((user) => (
                <option key={user} value={user}>
                  {user}
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
                <th style={{ width: 34 }} />
                <th>Date &amp; time</th>
                <th>User</th>
                <th>Action</th>
                <th>Type</th>
                <th>Record</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title={data.auditLog.length === 0 ? 'Nothing logged yet' : 'No matches'}
                      message={
                        data.auditLog.length === 0
                          ? 'Changes to shipments, expenses, withdrawals and settings appear here as they happen.'
                          : 'Try clearing a filter.'
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.slice(0, 500).map((entry) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  open={expanded.has(entry.id)}
                  onToggle={() => toggle(entry.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {filtered.length > 500 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Showing the most recent 500 of {filtered.length} entries.
        </p>
      )}
    </div>
  );
}

function AuditRow({
  entry,
  open,
  onToggle,
}: {
  entry: AuditEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const changedFields = useMemo(() => {
    const keys = new Set([
      ...Object.keys(entry.previousValue ?? {}),
      ...Object.keys(entry.newValue ?? {}),
    ]);
    keys.delete('createdAt');
    keys.delete('updatedAt');
    return [...keys].sort();
  }, [entry.previousValue, entry.newValue]);

  const summary =
    entry.action === 'created'
      ? 'Record created'
      : entry.action === 'deleted'
        ? 'Record deleted'
        : changedFields.length === 0
          ? 'No field changes'
          : changedFields.map(humanField).join(', ');

  return (
    <>
      <tr>
        <td>
          {changedFields.length > 0 && (
            <button className="btn ghost small" onClick={onToggle} aria-label={open ? 'Collapse' : 'Expand'}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </td>
        <td className="nowrap">{formatDateTime(entry.timestamp)}</td>
        <td>{entry.userName}</td>
        <td>
          <span className={ACTION_TONE[entry.action] ?? 'badge neutral'}>
            {entry.action.replace('-', ' ')}
          </span>
        </td>
        <td className="muted">{ENTITY_LABELS[entry.entity] ?? entry.entity}</td>
        <td>{entry.entityLabel}</td>
        <td className="muted">{summary}</td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--surface-alt)', padding: '0 14px 14px 48px' }}>
            <table className="data" style={{ background: 'var(--surface)', marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Previous value</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {changedFields.map((field) => (
                  <tr key={field}>
                    <td>{humanField(field)}</td>
                    <td className="muted">
                      {renderValue(field, (entry.previousValue ?? {})[field])}
                    </td>
                    <td>
                      <strong>{renderValue(field, (entry.newValue ?? {})[field])}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

import { useState } from 'react';
import { doc } from 'firebase/firestore';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { db } from '@/firebase/config';
import { customersCol } from '@/firebase/collections';
import { createRecord, updateRecord } from '@/firebase/repository';
import { PAYMENT_TERMS, type Customer } from '@/domain/types';
import { Banner, Card, Field, Modal } from '@/components/ui';

export type CustomerDraft = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;

export const EMPTY_CUSTOMER: CustomerDraft = {
  companyName: '',
  poc: '',
  phone: '',
  email: '',
  billingAddress: '',
  shippingAddress: '',
  notes: '',
  paymentTermsDays: 30,
  creditLimit: null,
  taxId: '',
  agencyIds: [],
  assignedEmployeeIds: [],
  active: true,
};

export default function CustomerForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Customer | CustomerDraft;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { actor, isEmployee, employeeId, user } = useAuth();
  const data = useData();

  const isEdit = 'id' in initial;
  const [draft, setDraft] = useState<CustomerDraft>({ ...(initial as CustomerDraft) });
  const [customTerms, setCustomTerms] = useState(
    !PAYMENT_TERMS.some((term) => term.days === (initial as CustomerDraft).paymentTermsDays),
  );
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the employee from every stable identifier we have.  A profile
  // document id and an Auth UID are intentionally different values; using the
  // UID fallback is what keeps a customer created on one device visible on a
  // second device even while an older users document is still cached there.
  const employeeProfile = data.employees.find((employee) =>
    (employeeId && employee.id === employeeId)
    || (actor?.userId && employee.userId === actor.userId)
    || (user?.email && employee.email?.trim().toLowerCase() === user.email.trim().toLowerCase()),
  );

  const set = <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  function toggleAgency(agencyId: string) {
    setDraft((prev) => ({
      ...prev,
      agencyIds: prev.agencyIds.includes(agencyId)
        ? prev.agencyIds.filter((id) => id !== agencyId)
        : [...prev.agencyIds, agencyId],
    }));
  }

  function toggleEmployee(employeeId: string) {
    setDraft((prev) => ({
      ...prev,
      assignedEmployeeIds: (prev.assignedEmployeeIds ?? []).includes(employeeId)
        ? (prev.assignedEmployeeIds ?? []).filter((id) => id !== employeeId)
        : [...(prev.assignedEmployeeIds ?? []), employeeId],
    }));
  }

  const duplicate = data.customers.some(
    (customer) =>
      customer.companyName.trim().toLowerCase() === draft.companyName.trim().toLowerCase() &&
      (!isEdit || customer.id !== (initial as Customer).id),
  );

  const assignedUserIdsFor = (customer: Pick<Customer, 'assignedEmployeeIds' | 'assignedEmployeeUserIds' | 'assignedEmployeeEmails'>) => {
    const userIds = new Set(customer.assignedEmployeeUserIds ?? []);
    for (const assignedId of customer.assignedEmployeeIds ?? []) {
      const employee = data.employees.find((row) => row.id === assignedId || row.userId === assignedId);
      if (employee?.userId) userIds.add(employee.userId);
    }
    for (const email of customer.assignedEmployeeEmails ?? []) {
      const employee = data.employees.find((row) => row.email?.trim().toLowerCase() === email.trim().toLowerCase());
      if (employee?.userId) userIds.add(employee.userId);
    }
    return [...userIds].filter(Boolean);
  };

  async function save() {
    if (!actor) return;
    setBusy(true);
    setError(null);

    const assignedEmployeeIds = (draft.assignedEmployeeIds ?? []).filter(Boolean);
    const assignedEmployeeUserIds = assignedEmployeeIds
      .map((assignedId) => data.employees.find((employee) => employee.id === assignedId)?.userId)
      .filter((uid): uid is string => Boolean(uid));
    const assignedEmployeeEmails = assignedEmployeeIds
      .map((assignedId) => data.employees.find((employee) => employee.id === assignedId)?.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email));

    // An employee-created customer is stamped with all stable identity keys:
    // the employee profile id, the Auth UID, and the normalised login email.
    // This makes the assignment resilient to legacy records and stale local
    // auth/profile caches on another device.  The UID is also kept in the
    // profile-id array as a safe fallback for records created before linking.
    const employeeScoped = isEmployee || Boolean(employeeProfile);
    const canonicalEmployeeId = employeeProfile?.id ?? employeeId ?? actor.userId;
    const employeeAssignment = employeeScoped
      ? {
          assignedEmployeeIds: [...new Set([canonicalEmployeeId, actor.userId].filter(Boolean))],
          assignedEmployeeUserIds: [actor.userId],
          assignedEmployeeEmails: user?.email
            ? [...new Set([user.email.trim(), user.email.trim().toLowerCase()])]
            : [],
          // The employee's working agency is the only agency selectable for
          // customers they create. This keeps the agency visible to admins
          // without exposing internal split settings to the employee.
          agencyIds: employeeProfile?.agencyId ? [employeeProfile.agencyId] : draft.agencyIds,
        }
      : {};
    const payload: CustomerDraft = {
      ...draft,
      companyName: draft.companyName.trim(),
      shippingAddress: sameAsBilling ? draft.billingAddress : draft.shippingAddress,
      assignedEmployeeIds,
      assignedEmployeeUserIds,
      assignedEmployeeEmails,
      ...employeeAssignment,
    };
    const desiredAccessUserIds = employeeScoped ? [actor.userId] : assignedUserIdsFor(payload);

    try {
      if (isEdit) {
        const existing = initial as Customer;
        const previousAccessUserIds = assignedUserIdsFor(existing);
        await updateRecord(
          customersCol,
          {
            entity: 'customer',
            label: payload.companyName,
            actor,
            id: existing.id,
            previous: existing as unknown as Record<string, unknown>,
            onUpdate: ({ batch, id: customerId, updatedAt }) => {
              // Assignment changes and the login access index must never drift
              // apart. Write new employee entries and remove old ones in this
              // exact customer-update batch.
              for (const userId of desiredAccessUserIds) {
                batch.set(
                  doc(db, 'users', userId, 'customerAccess', customerId),
                  { customerId, createdAt: existing.createdAt ?? updatedAt },
                );
              }
              for (const userId of previousAccessUserIds) {
                if (!desiredAccessUserIds.includes(userId)) {
                  batch.delete(doc(db, 'users', userId, 'customerAccess', customerId));
                }
              }
            },
          },
          payload,
        );
        onSaved?.(existing.id);
      } else {
        // Each assigned login receives a child index entry in the *same*
        // Firestore batch as the customer. This is deliberately not a
        // follow-up write: an employee can never end up with a customer that
        // exists for admins but has no cross-device access entry.
        const id = await createRecord(
          customersCol,
          {
            entity: 'customer',
            label: payload.companyName,
            actor,
            onCreate: ({ batch, id: customerId, createdAt }) => {
              for (const userId of new Set(desiredAccessUserIds)) {
                batch.set(
                  doc(db, 'users', userId, 'customerAccess', customerId),
                  { customerId, createdAt },
                );
              }
            },
          },
          payload,
        );
        onSaved?.(id);
      }
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isEdit ? `Edit ${(initial as Customer).companyName}` : 'New customer'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => void save()}
            disabled={busy || draft.companyName.trim().length === 0}
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create customer'}
          </button>
        </>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {duplicate && (
        <Banner tone="warning">
          A customer called “{draft.companyName.trim()}” already exists. Saving will create a second
          record with the same name.
        </Banner>
      )}

      <div className="field-row">
        <Field label="Company name">
          <input
            value={draft.companyName}
            autoFocus
            onChange={(e) => set('companyName', e.target.value)}
          />
        </Field>
        <Field label="Primary contact (POC)">
          <input value={draft.poc} onChange={(e) => set('poc', e.target.value)} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Phone">
          <input type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
      </div>

      <Field label="Billing address">
        <textarea
          value={draft.billingAddress}
          onChange={(e) => set('billingAddress', e.target.value)}
        />
      </Field>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={sameAsBilling}
          onChange={(e) => setSameAsBilling(e.target.checked)}
        />
        <span>Shipping address is the same as billing</span>
      </label>

      {!sameAsBilling && (
        <Field label="Shipping address">
          <textarea
            value={draft.shippingAddress}
            onChange={(e) => set('shippingAddress', e.target.value)}
          />
        </Field>
      )}

      <div className="field-row">
        <Field label="Payment terms" help="Sets when each invoice falls due.">
          <select
            value={customTerms ? 'custom' : String(draft.paymentTermsDays)}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                setCustomTerms(true);
                return;
              }
              setCustomTerms(false);
              set('paymentTermsDays', Number(e.target.value));
            }}
          >
            {PAYMENT_TERMS.map((term) => (
              <option key={term.days} value={term.days}>
                {term.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </Field>

        {customTerms && (
          <Field label="Days until due">
            <input
              type="number"
              min={0}
              value={draft.paymentTermsDays}
              onChange={(e) => set('paymentTermsDays', Math.max(0, Number(e.target.value)))}
            />
          </Field>
        )}

        <Field label="Credit limit" help="Optional. Leave blank if there's no agreed limit.">
          <input
            type="number"
            step="0.01"
            min="0"
            value={draft.creditLimit ?? ''}
            placeholder="None"
            onChange={(e) =>
              set('creditLimit', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </Field>

        <Field label="Tax ID" help="Optional.">
          <input value={draft.taxId} onChange={(e) => set('taxId', e.target.value)} />
        </Field>
      </div>

      {!isEmployee && <Card title="Assigned agencies">
        <p className="help" style={{ marginTop: 0 }}>
          Pick the brokerages this customer ships under. When you book a load for them, the agency
          dropdown narrows to these. Leave every box unticked to allow any agency.
        </p>
        {data.agencies.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No agencies set up yet.
          </p>
        ) : (
          <div className="stack" style={{ marginTop: 10 }}>
            {data.agencies.map((agency) => (
              <label className="checkbox" key={agency.id}>
                <input
                  type="checkbox"
                  checked={draft.agencyIds.includes(agency.id)}
                  onChange={() => toggleAgency(agency.id)}
                />
                <span>
                  {agency.name}{' '}
                  <span className="muted">
                    ({agency.agentPercent}/{agency.agencyPercent})
                    {agency.active ? '' : ' — inactive'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Card>}

      {!isEmployee && <Card title="Assigned employees">
        <p className="help" style={{ marginTop: 0 }}>
          These employees can view this customer in the restricted employee CRM.
        </p>
        {data.employees.length === 0 ? <p className="muted" style={{ margin: 0 }}>No employees set up yet.</p> : (
          <div className="stack" style={{ marginTop: 10 }}>
            {data.employees.filter((employee) => employee.active).map((employee) => (
              <label className="checkbox" key={employee.id}>
                <input type="checkbox" checked={(draft.assignedEmployeeIds ?? []).includes(employee.id)} onChange={() => toggleEmployee(employee.id)} />
                <span>{employee.name}</span>
              </label>
            ))}
          </div>
        )}
      </Card>}

      {isEmployee && (
        <Card title="Working agency">
          <p className="help" style={{ margin: 0 }}>
            This customer will be linked automatically to your working agency:
            {' '}{employeeProfile?.agencyName ?? 'your assigned agency'}.
          </p>
        </Card>
      )}

      <Field label="Notes">
        <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      <label className="checkbox">
        <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
        <span>
          <strong>Active</strong>
          <br />
          <span className="muted">Inactive customers stay on past loads but can't be picked for new ones.</span>
        </span>
      </label>
    </Modal>
  );
}

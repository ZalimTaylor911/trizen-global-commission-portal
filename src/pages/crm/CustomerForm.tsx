import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
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
  const { actor } = useAuth();
  const data = useData();

  const isEdit = 'id' in initial;
  const [draft, setDraft] = useState<CustomerDraft>({ ...(initial as CustomerDraft) });
  const [customTerms, setCustomTerms] = useState(
    !PAYMENT_TERMS.some((term) => term.days === (initial as CustomerDraft).paymentTermsDays),
  );
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const duplicate = data.customers.some(
    (customer) =>
      customer.companyName.trim().toLowerCase() === draft.companyName.trim().toLowerCase() &&
      (!isEdit || customer.id !== (initial as Customer).id),
  );

  async function save() {
    if (!actor) return;
    setBusy(true);
    setError(null);

    const payload: CustomerDraft = {
      ...draft,
      companyName: draft.companyName.trim(),
      shippingAddress: sameAsBilling ? draft.billingAddress : draft.shippingAddress,
    };

    try {
      if (isEdit) {
        const existing = initial as Customer;
        await updateRecord(
          customersCol,
          {
            entity: 'customer',
            label: payload.companyName,
            actor,
            id: existing.id,
            previous: existing as unknown as Record<string, unknown>,
          },
          payload,
        );
        onSaved?.(existing.id);
      } else {
        const id = await createRecord(
          customersCol,
          { entity: 'customer', label: payload.companyName, actor },
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

      <Card title="Assigned agencies">
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
      </Card>

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

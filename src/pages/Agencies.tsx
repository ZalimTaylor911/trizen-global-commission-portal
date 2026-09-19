import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { agenciesCol, employeesCol } from '@/firebase/collections';
import { createRecord, deleteRecord, updateRecord } from '@/firebase/repository';
import { computeAgencySummaries, validateAgency } from '@/domain/engine';
import { formatCurrency } from '@/domain/money';
import { Banner, Card, ConfirmDialog, Field, Modal, Spinner } from '@/components/ui';
import { agencyPaymentEligibilityFor, type Agency } from '@/domain/types';

type Draft = Omit<Agency, 'id' | 'createdAt' | 'updatedAt'>;

const EMPTY: Draft = { name: '', agentPercent: 50, agencyPercent: 50, employeeCommissionBasisPercent: null, agencyPaymentEligibility: 'customer-paid', active: true };

export default function Agencies() {
  const { actor } = useAuth();
  const data = useData();

  const [editing, setEditing] = useState<Agency | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Agency | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaries = useMemo(
    () =>
      new Map(
        computeAgencySummaries({
          shipments: data.shipments,
          agencies: data.agencies,
          partners: data.partners,
          expenses: data.expenses,
          withdrawals: data.withdrawals,
        }).map((summary) => [summary.agencyId, summary]),
      ),
    [data],
  );

  async function handleSave(draft: Draft) {
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await updateRecord(
          agenciesCol,
          {
            entity: 'agency',
            label: draft.name,
            actor,
            id: editing.id,
            previous: editing as unknown as Record<string, unknown>,
          },
          draft,
        );
        const disclosedBasis = draft.employeeCommissionBasisPercent ?? draft.agentPercent;
        await Promise.all(data.employees.filter((employee) => employee.agencyId === editing.id).map((employee) => updateRecord(
          employeesCol,
          { entity: 'employee', label: employee.name, actor, id: employee.id, previous: employee as unknown as Record<string, unknown> },
          { agencyName: draft.name, agencyBasisPercent: disclosedBasis },
        )));
      } else {
        await createRecord(agenciesCol, { entity: 'agency', label: draft.name, actor }, draft);
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
      await deleteRecord(agenciesCol, {
        entity: 'agency',
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

  async function seedGlt() {
    if (!actor) return;
    setBusy(true);
    try {
      await createRecord(
        agenciesCol,
        { entity: 'agency', label: 'GLT Logistics', actor },
        { name: 'GLT Logistics', agentPercent: 50, agencyPercent: 50, employeeCommissionBasisPercent: null, agencyPaymentEligibility: 'customer-paid', active: true },
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (data.loading) return <Spinner label="Loading agencies…" />;

  const shipmentCount = (agencyId: string) =>
    data.shipments.filter((shipment) => shipment.agencyId === agencyId).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Agencies</h1>
          <p>Each brokerage sets its own split. The team's share is what gets distributed to partners.</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            New agency
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Agency</th>
                <th className="num">Team %</th>
                <th className="num">Agency %</th>
                <th>Agency payment</th>
                <th>Status</th>
                <th className="num">Paid Loads</th>
                <th className="num">Net Margin</th>
                <th className="num">Agency Earnings</th>
                <th className="num">Team Earnings</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.agencies.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <div className="empty">
                      <strong>No agencies yet</strong>
                      <span>Add the brokerages you work with, or start with the one on file.</span>
                      <div style={{ marginTop: 14 }}>
                        <button className="btn primary" onClick={() => void seedGlt()} disabled={busy}>
                          Add GLT Logistics (50 / 50)
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {data.agencies.map((agency) => {
                const summary = summaries.get(agency.id);
                return (
                  <tr key={agency.id}>
                    <td>
                      <strong>{agency.name}</strong>
                    </td>
                    <td className="num">{agency.agentPercent}%</td>
                    <td className="num">{agency.agencyPercent}%</td>
                    <td>{agencyPaymentEligibilityFor(agency) === 'billed' ? 'After billing' : 'After customer payment'}</td>
                    <td>
                      <span className={agency.active ? 'badge success' : 'badge neutral'}>
                        {agency.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="num">{summary?.totalLoads ?? 0}</td>
                    <td className="num">{formatCurrency(summary?.netMargin ?? 0)}</td>
                    <td className="num">{formatCurrency(summary?.agencyEarnings ?? 0)}</td>
                    <td className="num">{formatCurrency(summary?.teamEarnings ?? 0)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn ghost small"
                          onClick={() => setEditing(agency)}
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="btn ghost small"
                          onClick={() => setDeleting(agency)}
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {(creating || editing) && (
        <AgencyForm
          initial={editing ?? EMPTY}
          isEdit={Boolean(editing)}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete agency"
          message={
            shipmentCount(deleting.id) > 0
              ? `${deleting.name} is used by ${shipmentCount(
                  deleting.id,
                )} shipment(s). Deleting it leaves those shipments without a commission split — mark it inactive instead unless you're sure.`
              : `Delete ${deleting.name}?`
          }
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function AgencyForm({
  initial,
  isEdit,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft | Agency;
  isEdit: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    ...(initial as Draft),
    agencyPaymentEligibility: agencyPaymentEligibilityFor(initial as Agency),
  }));
  const problem = validateAgency(draft);

  /** The two percentages always total 100, so moving one moves the other. */
  function setAgent(value: number) {
    setDraft((prev) => ({ ...prev, agentPercent: value, agencyPercent: Number((100 - value).toFixed(2)) }));
  }

  return (
    <Modal
      narrow
      title={isEdit ? 'Edit agency' : 'New agency'}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => onSave(draft)}
            disabled={busy || Boolean(problem) || !draft.name.trim()}
          >
            {busy ? 'Saving…' : 'Save agency'}
          </button>
        </>
      }
    >
      <Field label="Agency name">
        <input
          value={draft.name}
          autoFocus
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
        />
      </Field>

      <div className="field-row">
        <Field label="Team share %" help="What comes to Trizen.">
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={draft.agentPercent}
            onChange={(e) => setAgent(Number(e.target.value))}
          />
        </Field>
        <Field label="Agency share %" help="What the brokerage keeps.">
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={draft.agencyPercent}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                agencyPercent: Number(e.target.value),
                agentPercent: Number((100 - Number(e.target.value)).toFixed(2)),
              }))
            }
          />
        </Field>
      </div>

      <Field
        label="Agency payment eligibility"
        help="Controls when an admin can mark a shipment agency paid. OHT pays after billing; GLT pays after the customer pays. The payment timestamp is saved automatically when the admin marks it paid."
      >
        <select
          value={draft.agencyPaymentEligibility ?? 'customer-paid'}
          onChange={(e) => setDraft((prev) => ({ ...prev, agencyPaymentEligibility: e.target.value as Draft['agencyPaymentEligibility'] }))}
        >
          <option value="billed">After shipment is billed (OHT)</option>
          <option value="customer-paid">After customer payment (GLT)</option>
        </select>
      </Field>

      <Field
        label="Employee commission basis %"
        help="Optional disclosed team share for employee-owned loads. Example: keep the real split at 75/25, enter 60 here, and employee tiers/commission use 60% while company and partner books retain 75%. Leave blank to use the real team share."
      >
        <input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={draft.employeeCommissionBasisPercent ?? ''}
          placeholder={`Same as team share (${draft.agentPercent}%)`}
          onChange={(e) => setDraft((prev) => ({
            ...prev,
            employeeCommissionBasisPercent: e.target.value === '' ? null : Number(e.target.value),
          }))}
        />
      </Field>

      {problem && <Banner tone="error">{problem}</Banner>}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.checked }))}
        />
        <span>
          <strong>Active</strong>
          <br />
          <span className="muted">Inactive agencies stay on old shipments but can't be picked for new ones.</span>
        </span>
      </label>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { getDocs } from 'firebase/firestore';
import { FileSpreadsheet, FileText, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { employeesCol, usersCol } from '@/firebase/collections';
import { createRecord, deleteRecord, updateRecord } from '@/firebase/repository';
import { formatCurrency } from '@/domain/money';
import { isAgencyPaid } from '@/domain/engine';
import { monthLabel } from '@/lib/dates';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPdf } from '@/lib/export/pdf';
import type { ReportDocument } from '@/lib/export/types';
import type { Agency, CommissionTier, Employee } from '@/domain/types';
import { Banner, Card, ConfirmDialog, EmptyState, Field, Modal, Spinner } from '@/components/ui';

type Draft = Omit<Employee, 'id' | 'createdAt' | 'updatedAt'>;
const EMPTY: Draft = {
  agencyId: null,
  agencyBasisPercent: null,
  allowSlipPrinting: false,
  name: '', maxCommissionPercent: 30, active: true,
  compensationType: 'commission', monthlySalary: 0,
  commissionTiers: [{ minBusiness: 0, maxBusiness: null, commissionPercent: 0 }],
};

export default function Employees() {
  const data = useData();
  const { actor } = useAuth();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userProfiles, setUserProfiles] = useState<Record<string, { name?: string; firstName?: string; lastName?: string; phone?: string; address?: string; email?: string }>>({});

  useEffect(() => {
    void getDocs(usersCol).then((snapshot) => {
      const next: typeof userProfiles = {};
      snapshot.docs.forEach((entry) => { next[entry.id] = entry.data(); });
      setUserProfiles(next);
    }).catch(() => undefined);
  }, []);

  const hydratedEmployees = useMemo(() => data.employees.map((employee) => {
    const profile = employee.userId ? userProfiles[employee.userId] : undefined;
    if (!profile) return employee;
    // Older pending records accidentally stored the login email as the name.
    // Prefer the registration profile and never use an email as a display name.
    const employeeFirst = employee.firstName && !employee.firstName.includes('@') ? employee.firstName : '';
    const employeeLast = employee.lastName && !employee.lastName.includes('@') ? employee.lastName : '';
    const profileFirst = profile.firstName && !profile.firstName.includes('@') ? profile.firstName : '';
    const profileLast = profile.lastName && !profile.lastName.includes('@') ? profile.lastName : '';
    const firstName = profileFirst || employeeFirst;
    const lastName = profileLast || employeeLast;
    const profileName = profile.name && !profile.name.includes('@') ? profile.name : '';
    const storedName = employee.name && !employee.name.includes('@') ? employee.name : '';
    const name = (firstName || lastName) ? [firstName, lastName].filter(Boolean).join(' ') : (profileName || storedName || 'Unnamed employee');
    return { ...employee, name, firstName, lastName, contactPhone: profile.phone || employee.contactPhone || '', address: profile.address || employee.address || '', email: employee.email || profile.email };
  }), [data.employees, userProfiles]);

  async function approveLogin(employee: Employee) {
    if (!actor || !employee.userId) return;
    setBusy(true); setError(null);
    try {
      const user = { id: employee.userId, email: employee.email ?? '', name: employee.name, role: 'employee' as const, partnerId: '', employeeId: employee.id, status: 'pending' as const };
      await updateRecord(employeesCol, { entity: 'employee', label: employee.name, actor, id: employee.id, previous: employee as unknown as Record<string, unknown> }, { registrationStatus: 'approved', active: true });
      await updateRecord(usersCol, { entity: 'user', label: employee.name, actor, id: employee.userId, previous: user as unknown as Record<string, unknown> }, { role: 'employee', employeeId: employee.id, status: 'approved' });
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }

  async function save(draft: Draft) {
    if (!actor) return;
    setBusy(true); setError(null);
    try {
      const payload = {
        ...draft,
        agencyName: data.agencies.find((agency) => agency.id === draft.agencyId)?.name ?? null,
        agencyBasisPercent: draft.agencyBasisPercent
          ?? data.agencies.find((agency) => agency.id === draft.agencyId)?.employeeCommissionBasisPercent
          ?? data.agencies.find((agency) => agency.id === draft.agencyId)?.agentPercent
          ?? null,
      };
      if (editing) {
        await updateRecord(employeesCol, {
          entity: 'employee', label: editing.name, actor, id: editing.id,
          previous: editing as unknown as Record<string, unknown>,
        }, payload);
        // Keep the linked auth profile in sync so employee views and future
        // device logins use the corrected name/contact details immediately.
        if (editing.userId) {
          await updateRecord(usersCol, {
            entity: 'user', label: editing.name, actor, id: editing.userId,
            previous: userProfiles[editing.userId] as unknown as Record<string, unknown> ?? null,
          }, {
            name: payload.name,
            firstName: payload.firstName ?? '',
            lastName: payload.lastName ?? '',
            phone: payload.contactPhone ?? '',
            address: payload.address ?? '',
            email: payload.email ?? editing.email ?? '',
            employeeId: editing.id,
          });
        }
      } else {
        await createRecord(employeesCol, { entity: 'employee', label: draft.name, actor }, payload);
      }
      setCreating(false); setEditing(null);
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting || !actor) return;
    setBusy(true); setError(null);
    try {
      await deleteRecord(employeesCol, {
        entity: 'employee', label: deleting.name, actor, id: deleting.id,
        previous: deleting as unknown as Record<string, unknown>,
      });
      setDeleting(null);
    } catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }

  if (data.loading) return <Spinner label="Loading employees…" />;
  return <div className="page">
    <div className="page-header"><div><h1>Employees</h1><p>Salary, commission, or hybrid employees with monthly-business commission tiers.</p></div>
      <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} /> Add employee</button>
    </div>
    {error && <Banner tone="error">{error}</Banner>}
    <Card flush><div className="table-wrap"><table className="data"><thead><tr><th>Employee</th><th>Working agency</th><th>Login link</th><th>Compensation</th><th>Tiers</th><th className="num">Fallback rate</th><th>Status</th><th /></tr></thead><tbody>
      {hydratedEmployees.length === 0 ? <tr><td colSpan={8}><EmptyState title="No employees" message="Add an employee before assigning an employee shipment." /></td></tr> : hydratedEmployees.map((employee) => <tr key={employee.id}><td>{employee.name}</td><td>{data.agencies.find((agency) => agency.id === employee.agencyId)?.name ?? '—'}</td><td>{employee.userId ? <span className="badge positive">Linked</span> : <span className="badge warn">Link in Settings</span>}</td><td>{employee.compensationType === 'salary' ? `Salary · ${formatCurrency(employee.monthlySalary ?? 0)}/month` : employee.compensationType === 'salary-plus-commission' ? `Salary + commission · ${formatCurrency(employee.monthlySalary ?? 0)}/month` : 'Commission only'}</td><td>{employee.commissionTiers.length} configured</td><td className="num">{employee.maxCommissionPercent}%</td><td><span className={employee.registrationStatus === 'pending' ? 'badge warn' : employee.active ? 'badge positive' : 'badge neutral'}>{employee.registrationStatus === 'pending' ? 'Pending approval' : employee.active ? 'Active' : 'Disabled'}</span></td><td><div className="row-actions"><button className="btn ghost small" onClick={() => setEditing(employee)} aria-label="Edit"><Pencil size={14} /></button>{employee.registrationStatus === 'pending' && employee.userId && <button className="btn primary small" disabled={busy} onClick={() => void approveLogin(employee)}>Approve login</button>}<button className="btn ghost small" onClick={() => setDeleting(employee)} aria-label="Delete"><Trash2 size={14} /></button></div></td></tr>)}
    </tbody></table></div></Card>
    <EmployeePerformanceReport />
    {(creating || editing) && <EmployeeForm agencies={data.agencies} initial={editing ?? EMPTY} isEdit={Boolean(editing)} busy={busy} onCancel={() => { setCreating(false); setEditing(null); }} onSave={save} />}
    {deleting && <ConfirmDialog title="Delete employee" message={`Delete ${deleting.name}? Existing shipments will keep their recorded terms but show this employee as former.`} busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />}
  </div>;
}

/** Employee-safe month-end shipment report: no AR/AP, agency split, or core-team figures. */
function EmployeePerformanceReport() {
  const data = useData();
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState('');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const employeeLoads = useMemo(() => data.shipments.filter((shipment) =>
    shipment.ownerType === 'employee' && (!employeeId || shipment.employeeId === employeeId) && (!month || shipment.month === month),
  ), [data.shipments, employeeId, month]);
  const months = useMemo(() => [...new Set(data.shipments.filter((shipment) => shipment.ownerType === 'employee').map((shipment) => shipment.month))].sort().reverse(), [data.shipments]);
  const report: ReportDocument = useMemo(() => ({
    title: 'Employee Shipment Performance Report',
    subtitle: [employeeId ? data.employees.find((employee) => employee.id === employeeId)?.name : 'All employees', month ? monthLabel(month) : 'All months'].filter(Boolean).join(' · '),
    summary: [{ label: 'Employee shipments', value: String(employeeLoads.length) }, { label: 'Total Net Business', value: formatCurrency(employeeLoads.reduce((sum, shipment) => sum + shipment.grossMargin * ((shipment.employeeCommissionBasisPercent ?? 0) / 100), 0)) }],
    sheets: [{ name: 'Employee Shipments', columns: [
      { header: 'Employee' }, { header: 'Date' }, { header: 'Load #' }, { header: 'Customer' }, { header: 'Lane' }, { header: 'Shipment Status' }, { header: 'Commission Status' }, { header: 'Total Net Business', numeric: true, currency: true },
    ], rows: employeeLoads.map((shipment) => [
      data.employees.find((employee) => employee.id === shipment.employeeId)?.name ?? 'Former employee', shipment.date, shipment.loadNumber, shipment.companyName, shipment.lane, shipment.status, commissionStatus(shipment, data.employeeSettlements), Math.round(shipment.grossMargin * ((shipment.employeeCommissionBasisPercent ?? 0) / 100) * 100) / 100,
    ]) }],
  }), [data.employees, employeeId, employeeLoads, month]);
  async function exportReport(format: 'excel' | 'pdf') {
    setExporting(format);
    try { if (format === 'excel') await exportToExcel(report); else await exportToPdf(report); } finally { setExporting(null); }
  }
  return <><div style={{ height: 20 }} /><Card title="Employee Shipment Performance Report"><p className="help">Review employee-owned shipments for month-end performance discussion. This export contains no internal agency split, AR/AP, partner, or core-team financial data.</p><div className="filters">
    <Field label="Employee"><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">All employees</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></Field>
    <Field label="Month"><select value={month} onChange={(event) => setMonth(event.target.value)}><option value="">All months</option>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></Field>
    <button className="btn" disabled={exporting !== null || employeeLoads.length === 0} onClick={() => void exportReport('excel')}><FileSpreadsheet size={15} />{exporting === 'excel' ? 'Exporting…' : 'Export Excel'}</button>
    <button className="btn" disabled={exporting !== null || employeeLoads.length === 0} onClick={() => void exportReport('pdf')}><FileText size={15} />{exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}</button>
  </div><div style={{ height: 12 }} /><div className="muted">{employeeLoads.length} shipment{employeeLoads.length === 1 ? '' : 's'} · Total Net Business {formatCurrency(employeeLoads.reduce((sum, shipment) => sum + shipment.grossMargin * ((shipment.employeeCommissionBasisPercent ?? 0) / 100), 0))}</div></Card></>;
}

function commissionStatus(shipment: import('@/domain/types').Shipment, settlements: import('@/domain/types').EmployeeSettlementRecord[]): string {
  if (!isAgencyPaid(shipment)) return `Pending — ${shipment.status}`;
  const month = shipment.agencyPaidAt?.slice(0, 7) || shipment.agencyPaidDate?.slice(0, 7) || shipment.month;
  const settlement = settlements.find((record) => record.employeeId === shipment.employeeId && record.month === month);
  if (settlement?.status === 'paid') return 'Paid ✓';
  if (settlement?.status === 'unpaid') return 'Unpaid';
  return 'Ready to settle';
}

function EmployeeForm({ agencies, initial, isEdit, busy, onCancel, onSave }: { agencies: Agency[]; initial: Draft | Employee; isEdit: boolean; busy: boolean; onCancel: () => void; onSave: (draft: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(() => {
    const source = initial as Draft;
    const safeName = source.name && !source.name.includes('@') ? source.name : '';
    const [first = '', ...rest] = safeName.trim().split(/\s+/).filter(Boolean);
    const safeFirst = source.firstName && !source.firstName.includes('@') ? source.firstName : first;
    const safeLast = source.lastName && !source.lastName.includes('@') ? source.lastName : rest.join(' ');
    return { ...source, name: safeName, firstName: safeFirst, lastName: safeLast };
  });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const setTier = (index: number, changes: Partial<CommissionTier>) => setDraft((prev) => ({ ...prev, commissionTiers: prev.commissionTiers.map((tier, i) => i === index ? { ...tier, ...changes } : tier) }));
  const hasCommission = (draft.compensationType ?? 'commission') !== 'salary';
  const hasSalary = draft.compensationType === 'salary' || draft.compensationType === 'salary-plus-commission';
  const commissionValid = !hasCommission || (
    draft.maxCommissionPercent >= 0 && draft.maxCommissionPercent <= 100
    && draft.commissionTiers.length > 0
    && draft.commissionTiers.every((tier) => tier.minBusiness >= 0 && (tier.maxBusiness == null || tier.maxBusiness >= tier.minBusiness) && tier.commissionPercent >= 0 && tier.commissionPercent <= 100)
  );
  const valid = (draft.firstName?.trim() || draft.name.trim()) && commissionValid && (!hasSalary || (draft.monthlySalary ?? 0) >= 0);
  const submit = () => onSave({
    ...draft,
    name: [draft.firstName, draft.lastName].map((value) => value?.trim()).filter(Boolean).join(' ') || draft.name.trim(),
  });
  return <Modal narrow title={isEdit ? 'Edit employee' : 'New employee'} onClose={onCancel} footer={<><button className="btn" onClick={onCancel} disabled={busy}>Cancel</button><button className="btn primary" onClick={submit} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save employee'}</button></>}>
    <div className="field-row">
      <Field label="First name"><input autoFocus value={draft.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} /></Field>
      <Field label="Last name"><input value={draft.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} /></Field>
    </div>
    <div className="field-row">
      <Field label="Contact phone"><input type="tel" value={draft.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} /></Field>
      <Field label="Login email" help="Use the same email that will be created in Firebase Authentication, then link it from Settings."><input type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
    </div>
    <Field label="Address"><textarea value={draft.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
    <Field label="Working agency" help="Employees see the agency name only; internal split percentages remain admin-only.">
      <select value={draft.agencyId ?? ''} onChange={(e) => set('agencyId', e.target.value || null)}>
        <option value="">Select working agency</option>
        {agencies.filter((agency) => agency.active).map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}
      </select>
    </Field>
    {isEdit && (initial as Employee).userId && <Banner tone="info">Firebase login linked. Customer assignments use this login's permanent UID across all devices.</Banner>}
    <Field label="Employee-facing agency basis" help="For example, 60 means the employee sees a 60/40 basis. The actual company split stays hidden.">
      <input type="number" min={0} max={100} step="0.01" value={draft.agencyBasisPercent ?? ''} onChange={(e) => set('agencyBasisPercent', e.target.value === '' ? null : Number(e.target.value))} />
    </Field>
    <label className="checkbox"><input type="checkbox" checked={draft.allowSlipPrinting ?? false} onChange={(e) => set('allowSlipPrinting', e.target.checked)} /><span><strong>Allow paid slip printing</strong><br /><span className="muted">Employees can view paid slips, but PDF printing/export is controlled here.</span></span></label>
    <Field label="Additional information"><textarea value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
    <Field label="Compensation type">
      <select value={draft.compensationType ?? 'commission'} onChange={(e) => set('compensationType', e.target.value as Draft['compensationType'])}>
        <option value="commission">Commission only</option><option value="salary">Salary only</option><option value="salary-plus-commission">Salary + commission</option>
      </select>
    </Field>
    {hasSalary && <Field label="Monthly salary"><input type="number" min={0} step="0.01" value={draft.monthlySalary ?? 0} onChange={(e) => set('monthlySalary', Number(e.target.value))} /></Field>}
    {hasCommission && <>
    <Field label="Maximum commission percentage (fallback)" help="Used only when the employee’s final monthly business does not match any tier. A matching tier always uses its own commission percentage."><input type="number" min={0} max={100} step="0.01" value={draft.maxCommissionPercent} onChange={(e) => set('maxCommissionPercent', Number(e.target.value))} /></Field>
    <div className="section-title">Monthly business tiers</div>
    <p className="help">One tier is selected from the employee’s final monthly business total and applied to the entire amount. Use a blank maximum for the final open-ended tier.</p>
    {draft.commissionTiers.map((tier, index) => <div className="field-row" key={index}>
      <Field label="Minimum business"><input type="number" min={0} step="0.01" value={tier.minBusiness} onChange={(e) => setTier(index, { minBusiness: Number(e.target.value) })} /></Field>
      <Field label="Maximum business"><input type="number" min={0} step="0.01" value={tier.maxBusiness ?? ''} placeholder="No maximum" onChange={(e) => setTier(index, { maxBusiness: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
      <Field label="Commission %"><input type="number" min={0} max={100} step="0.01" value={tier.commissionPercent} onChange={(e) => setTier(index, { commissionPercent: Number(e.target.value) })} /></Field>
      <button className="btn ghost small" type="button" disabled={draft.commissionTiers.length === 1} onClick={() => setDraft((prev) => ({ ...prev, commissionTiers: prev.commissionTiers.filter((_, i) => i !== index) }))} aria-label="Remove tier"><X size={14} /></button>
    </div>)}
    <button className="btn small" type="button" onClick={() => setDraft((prev) => ({ ...prev, commissionTiers: [...prev.commissionTiers, { minBusiness: 0, maxBusiness: null, commissionPercent: 0 }] }))}><Plus size={14} /> Add tier</button>
    </>}
    <label className="checkbox"><input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} /><span><strong>Active</strong><br /><span className="muted">Disabled employees cannot be assigned to new shipments.</span></span></label>
  </Modal>;
}

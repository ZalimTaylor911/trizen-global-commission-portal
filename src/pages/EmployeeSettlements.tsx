import { useMemo, useState } from 'react';
import { CheckCircle, Eye, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { employeeSettlementsCol, expenseCategoriesCol, expensesCol } from '@/firebase/collections';
import { createRecord, updateRecord } from '@/firebase/repository';
import { computeEmployeeSettlements } from '@/domain/engine';
import { formatCurrency } from '@/domain/money';
import type { EmployeeSettlementRecord, Expense } from '@/domain/types';
import { Banner, Card, EmptyState, Modal, Spinner } from '@/components/ui';

export default function EmployeeSettlements() {
  const data = useData();
  const { actor, isEmployee, employeeId } = useAuth();
  const navigate = useNavigate();
  const calculated = useMemo(() => computeEmployeeSettlements({
    shipments: isEmployee && employeeId
      ? data.shipments.map((shipment) => shipment.employeeId === employeeId && data.employees.find((employee) => employee.id === employeeId)?.agencyBasisPercent != null
        ? { ...shipment, employeeCommissionBasisPercent: data.employees.find((employee) => employee.id === employeeId)?.agencyBasisPercent }
        : shipment)
      : data.shipments,
    agencies: data.agencies, partners: data.partners, employees: data.employees,
    expenses: data.expenses, withdrawals: data.withdrawals,
  }), [data, isEmployee, employeeId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<typeof calculated[number] | null>(null);
  const recordByKey = new Map(data.employeeSettlements.map((record) => [`${record.employeeId}:${record.month}`, record]));

  async function markPaid(settlement: typeof calculated[number], existing?: EmployeeSettlementRecord) {
    // Payment is an admin-only accounting action. Employees can review
    // settlement previews, but cannot create payroll expenses or mark their
    // own settlement paid.
    if (isEmployee || !actor || existing?.status === 'paid') return;
    const key = `${settlement.employeeId}:${settlement.month}`;
    setBusy(key); setError(null);
    try {
      let record = existing;
      if (!record) {
        const employee = data.employees.find((row) => row.id === settlement.employeeId);
        const payload: Omit<EmployeeSettlementRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          employeeId: settlement.employeeId, employeeName: settlement.employeeName, month: settlement.month,
          compensationType: employee?.compensationType ?? 'commission', totalNetBusiness: settlement.commissionBasisGenerated,
          totalShipments: settlement.shipments.length, salary: settlement.baseSalary,
          commission: settlement.commissionCalculated, totalDue: settlement.finalPayout, status: 'unpaid', paidAt: null, expenseId: null,
        };
        const id = await createRecord(employeeSettlementsCol, { entity: 'employee-settlement', label: `${settlement.employeeName} · ${settlement.month}`, actor }, payload);
        record = { id, ...payload };
      }
      let payrollCategory = data.expenseCategories.find((category) => category.name.trim().toLowerCase() === 'payroll');
      if (!payrollCategory) {
        const id = await createRecord(expenseCategoriesCol, { entity: 'expense-category', label: 'Payroll', actor }, { name: 'Payroll', active: true });
        payrollCategory = { id, name: 'Payroll', active: true };
      }
      const expense: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'> = {
        type: 'employee-compensation', categoryId: payrollCategory.id, amount: record.totalDue, date: `${record.month}-01`, month: record.month,
        notes: `Paid employee settlement — ${record.employeeName}: salary ${formatCurrency(record.salary)}, commission ${formatCurrency(record.commission)}.`,
        shipmentId: null, employeeId: record.employeeId, employeeSettlementKey: `${record.employeeId}:${record.month}`,
      };
      const expenseId = await createRecord(expensesCol, { entity: 'expense', label: `Employee payment — ${record.employeeName} (${record.month})`, actor }, expense);
      await updateRecord(employeeSettlementsCol, { entity: 'employee-settlement', label: `${record.employeeName} · ${record.month}`, actor, id: record.id, previous: record as unknown as Record<string, unknown> }, { status: 'paid', paidAt: new Date().toISOString(), expenseId });
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(null); }
  }

  if (data.loading) return <Spinner label="Loading employee settlements…" />;
  return <div className="page"><div className="page-header"><div><h1>Employee Settlements</h1><p>Commission is calculated from each employee’s approved monthly-business tier. Partner deductions and payroll expense appear only after a settlement is marked paid.</p></div></div>
    {error && <Banner tone="error">{error}</Banner>}
    <Card flush><div className="table-wrap"><table className="data"><thead><tr><th>Month</th><th>Employee</th><th className="num">AR</th><th className="num">AP</th><th className="num">Gross business</th><th className="num">Commission basis</th><th className="num">Applied rate</th><th className="num">Total Shipments</th><th className="num">Salary</th><th className="num">Commission</th><th className="num">Total payable</th><th>Status</th><th /></tr></thead><tbody>
      {calculated.length === 0 ? <tr><td colSpan={13}><EmptyState title="No settlements ready" message="Employee-owned loads appear here after agency payment is recorded." /></td></tr> : calculated.map((settlement) => {
        const key = `${settlement.employeeId}:${settlement.month}`; const record = recordByKey.get(key); const hasSalary = record?.compensationType === 'salary' || record?.compensationType === 'salary-plus-commission';
        const ar = settlement.shipments.reduce((sum, shipment) => sum + shipment.ar, 0);
        const ap = settlement.shipments.reduce((sum, shipment) => sum + shipment.ap, 0);
        const gross = settlement.shipments.reduce((sum, shipment) => sum + shipment.grossMargin, 0);
        return <tr key={key}><td>{settlement.month}</td><td>{settlement.employeeName}</td><td className="num">{formatCurrency(ar)}</td><td className="num">{formatCurrency(ap)}</td><td className="num">{formatCurrency(gross)}</td><td className="num">{formatCurrency(settlement.commissionBasisGenerated)}</td><td className="num">{record?.compensationType === 'salary' ? '—' : `${settlement.commissionPercent}%${settlement.applicableTier ? '' : ' fallback'}`}</td><td className="num">{settlement.shipments.length}</td><td className="num">{hasSalary ? formatCurrency(record?.salary ?? settlement.baseSalary) : '—'}</td><td className="num">{record?.compensationType === 'salary' ? '—' : formatCurrency(record?.commission ?? settlement.commissionCalculated)}</td><td className="num">{formatCurrency(record?.totalDue ?? settlement.finalPayout)}</td><td><span className={record?.status === 'paid' ? 'badge success' : 'badge warn'}>{record?.status === 'paid' ? 'Paid' : record ? 'Unpaid' : 'Ready'}</span></td><td><button className="btn ghost small" onClick={() => setPreview(settlement)}><Eye size={14} /> Preview</button><button className="btn ghost small" onClick={() => navigate(`/employees/slips?employeeId=${settlement.employeeId}&month=${settlement.month}`)}><FileText size={14} /> Slip</button>{!isEmployee && (!record || record.status === 'unpaid') ? <button className="btn primary small" disabled={busy !== null} onClick={() => void markPaid(settlement, record)}><CheckCircle size={14} /> Mark paid</button> : null}</td></tr>;
      })}
    </tbody></table></div></Card>{preview && <Modal narrow title={`Settlement preview · ${preview.employeeName}`} onClose={() => setPreview(null)} footer={<><button className="btn" onClick={() => setPreview(null)}>Close</button><button className="btn primary" onClick={() => { setPreview(null); navigate(`/employees/slips?employeeId=${preview.employeeId}&month=${preview.month}`); }}><FileText size={14} /> Preview slip</button></>}><div className="partner-rows"><div><span>Month</span><strong>{preview.month}</strong></div><div><span>Commission basis</span><strong>{formatCurrency(preview.commissionBasisGenerated)}</strong></div><div><span>Applied rate</span><strong>{preview.commissionPercent}%{preview.applicableTier ? '' : ' (maximum fallback)'}</strong></div><div><span>Total Shipments</span><strong>{preview.shipments.length}</strong></div><div><span>Salary</span><strong>{preview.baseSalary ? formatCurrency(preview.baseSalary) : '—'}</strong></div><div><span>Commission</span><strong>{preview.commissionCalculated ? formatCurrency(preview.commissionCalculated) : '—'}</strong></div><div className="total"><span>Total Payable</span><strong>{formatCurrency(preview.finalPayout)}</strong></div></div></Modal>}</div>;
}

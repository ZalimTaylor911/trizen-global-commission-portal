import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Columns3,
  Check,
  ChevronDown,
  Copy,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { shipmentsCol } from '@/firebase/collections';
import { createRecord, deleteRecord, updateRecord } from '@/firebase/repository';
import {
  BILLED_STATUS,
  LEGACY_AGENCY_PAID_STATUS,
  SHIPMENT_STATUSES,
  SHIPMENT_TYPES,
  agencyPaymentEligibilityFor,
  paymentTermsLabel,
  type Shipment,
  type ShipmentStatus,
  type ShipmentType,
} from '@/domain/types';
import { computeNetMargin, freezeCommissionSplit, isAgencyPaid, splitShipment } from '@/domain/engine';
import { agenciesForCustomer } from '@/domain/customers';
import { addDays } from '@/domain/receivables';
import { deliveryPerformance, estimateDelivery } from '@/domain/transit';
import { formatCurrency, round2 } from '@/domain/money';
import { distinctMonths, formatDate, monthLabel, monthOf, today } from '@/lib/dates';
import BulkImport from '@/components/BulkImport';
import ColumnManager from '@/components/ColumnManager';
import DataTable from '@/components/DataTable';
import { useTablePrefs, type Column } from '@/lib/useTablePrefs';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPdf } from '@/lib/export/pdf';
import {
  Banner,
  Card,
  ConfirmDialog,
  Field,
  Modal,
  Spinner,
  StatusBadge,
} from '@/components/ui';

export type Draft = Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>;

function emptyDraft(agencyId: string): Draft {
  const date = today();
  return {
    month: monthOf(date),
    date,
    customerId: '',
    companyName: '',
    poc: '',
    lane: '',
    ar: 0,
    carrierName: '',
    ap: 0,
    grossMargin: 0,
    netMargin: 0,
    loadNumber: '',
    status: 'Assigned',
    shipmentType: 'FTL',
    agencyId,
    ownerType: 'core-team',
    employeeId: null,
    employeeCommissionTiers: null,
    employeeMaxCommissionPercent: null,
    employeeCommissionBasisPercent: null,
    agencyPaid: false,
    agencyPaidAt: null,
    customerPaidAt: null,
    invoicedDate: '',
    transitDays: 0,
    actualPickupDate: '',
    estimatedDeliveryDate: '',
    actualDeliveryDate: '',
    notes: '',
  };
}

const NO_FILTERS = {
  month: [] as string[],
  agency: [] as string[],
  status: [] as string[],
  agencyPayment: [] as string[],
  type: [] as string[],
  customer: [] as string[],
  carrier: [] as string[],
  lane: [] as string[],
  owner: [] as string[],
  search: '',
};

/** Distinct non-empty values of a field, alphabetised, for the filter dropdowns. */
function distinctValues(shipments: Shipment[], pick: (shipment: Shipment) => string): string[] {
  return [...new Set(shipments.map(pick).map((value) => value.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export default function Shipments({ openCreate = false }: { openCreate?: boolean }) {
  const { isAdmin, isEmployee, employeeId, actor, user } = useAuth();
  const data = useData();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<Shipment | null>(null);
  const [creating, setCreating] = useState(openCreate);
  const [deleting, setDeleting] = useState<Shipment | null>(null);
  const [importing, setImporting] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [copiedLoad, setCopiedLoad] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPaymentDialog, setBulkPaymentDialog] = useState(false);
  const [bulkPaymentDate, setBulkPaymentDate] = useState(today());
  const [bulkUnpayConfirm, setBulkUnpayConfirm] = useState(false);

  const set = <K extends keyof typeof NO_FILTERS>(key: K, value: (typeof NO_FILTERS)[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  async function copyLoadNumber(shipment: Shipment) {
    if (!shipment.loadNumber) return;
    try {
      // Electron can run in a context where navigator.clipboard is unavailable.
      // Keep the modern API first, then use the reliable desktop fallback.
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(shipment.loadNumber);
          copied = true;
        } catch {
          // Fall through: Electron can expose the API but deny this context.
        }
      }
      if (!copied) {
        const input = document.createElement('textarea');
        input.value = shipment.loadNumber;
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('Copy command was rejected');
      }
      setCopiedLoad(shipment.id);
      window.setTimeout(() => setCopiedLoad((id) => id === shipment.id ? null : id), 1500);
    } catch {
      setError('Could not copy the load number. Please copy it manually.');
    }
  }

  const agencyById = useMemo(
    () => new Map(data.agencies.map((agency) => [agency.id, agency])),
    [data.agencies],
  );
  // Resolve from both the persisted employee profile id and the permanent
  // Firebase Auth UID. This gives a newly approved employee the exact profile
  // id required by shipment rules even before an older device refreshes its
  // users.employeeId field.
  const currentEmployee = useMemo(
    () => data.employees.find((employee) => employee.id === employeeId || employee.userId === user?.uid),
    [data.employees, employeeId, user?.uid],
  );
  const employeeById = useMemo(
    () => new Map(data.employees.map((employee) => [employee.id, employee])),
    [data.employees],
  );

  const months = useMemo(() => distinctMonths(data.shipments), [data.shipments]);
  const customers = useMemo(() => distinctValues(data.shipments, (s) => s.companyName), [data.shipments]);
  const carriers = useMemo(() => distinctValues(data.shipments, (s) => s.carrierName), [data.shipments]);
  const lanes = useMemo(() => distinctValues(data.shipments, (s) => s.lane), [data.shipments]);

  const filtered = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return data.shipments.filter((shipment) => {
      if (filters.month.length && !filters.month.includes(shipment.month)) return false;
      if (filters.agency.length && !filters.agency.includes(shipment.agencyId)) return false;
      const displayStatus = isAgencyPaid(shipment) ? 'Customer Paid' : shipment.status;
      if (filters.status.length && !filters.status.includes(displayStatus)) return false;
      if (filters.agencyPayment.length) {
        const paymentState = isAgencyPaid(shipment) ? 'paid' : 'unpaid';
        if (!filters.agencyPayment.includes(paymentState)) return false;
      }
      if (filters.type.length && !filters.type.includes(shipment.shipmentType)) return false;
      if (filters.customer.length && !filters.customer.includes(shipment.companyName)) return false;
      if (filters.carrier.length && !filters.carrier.includes(shipment.carrierName)) return false;
      if (filters.lane.length && !filters.lane.includes(shipment.lane)) return false;
      const owner = shipment.ownerType === 'employee' ? `employee:${shipment.employeeId ?? ''}` : 'core-team';
      if (filters.owner.length && !filters.owner.includes(owner)) return false;
      if (!needle) return true;
      return [shipment.companyName, shipment.loadNumber, shipment.lane, shipment.carrierName, shipment.poc]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [data.shipments, filters]);

  const selectedShipments = useMemo(
    () => data.shipments.filter((shipment) => selectedIds.includes(shipment.id)),
    [data.shipments, selectedIds],
  );
  const eligibleSelected = useMemo(
    () => selectedShipments.filter((shipment) => {
      if (isAgencyPaid(shipment)) return false;
      const eligibility = agencyPaymentEligibilityFor(agencyById.get(shipment.agencyId));
      return eligibility === 'billed' ? shipment.status === 'Billed' : shipment.status === 'Customer Paid';
    }),
    [agencyById, selectedShipments],
  );
  const paidSelected = useMemo(
    () => selectedShipments.filter((shipment) => isAgencyPaid(shipment)),
    [selectedShipments],
  );

  /**
   * Column set for the customisable table. `value` doubles as the sort key and
   * the exported cell, so what you sort by is what lands in the spreadsheet.
   */
  const columns = useMemo<Column<Shipment>[]>(() => {
    const list: Column<Shipment>[] = [
      {
        id: 'date',
        header: 'Date',
        width: 110,
        value: (s) => s.date,
        render: (s) => formatDate(s.date),
      },
      {
        id: 'loadNumber',
        header: 'Invoice / Load #',
        width: 170,
        value: (s) => s.loadNumber,
        render: (s) => (
          <div className="shipment-load-number" onClick={(e) => e.stopPropagation()}>
            <Link to={`/shipments/${s.id}`} className="mono" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
              {s.loadNumber || 'View'}
            </Link>
            {s.loadNumber && <button className="btn ghost small" onClick={() => void copyLoadNumber(s)} aria-label={`Copy ${s.loadNumber}`} title="Copy load number">
              {copiedLoad === s.id ? <Check size={13} /> : <Copy size={13} />}
            </button>}
          </div>
        ),
      },
      {
        id: 'company',
        header: 'Company',
        width: 170,
        value: (s) => s.companyName,
        render: (s) => s.companyName,
      },
      { id: 'poc', header: 'POC', width: 130, value: (s) => s.poc, render: (s) => s.poc || '—' },
      { id: 'lane', header: 'Lane', width: 200, value: (s) => s.lane, render: (s) => s.lane || '—' },
      {
        id: 'carrier',
        header: 'Carrier',
        width: 160,
        value: (s) => s.carrierName,
        render: (s) => s.carrierName || '—',
      },
      {
        id: 'type',
        header: 'Type',
        width: 80,
        value: (s) => s.shipmentType,
        render: (s) => <span className="badge neutral">{s.shipmentType}</span>,
      },
      { id: 'ar', header: 'AR', width: 110, numeric: true, value: (s) => s.ar, render: (s) => formatCurrency(s.ar) },
      { id: 'ap', header: 'AP', width: 110, numeric: true, value: (s) => s.ap, render: (s) => formatCurrency(s.ap) },
      {
        id: 'gross',
        header: 'Gross business',
        width: 155,
        numeric: true,
        value: (s) => s.grossMargin,
        render: (s) => formatCurrency(s.grossMargin),
      },
      {
        id: 'agency',
        header: 'Agency',
        width: 150,
        value: (s) => agencyById.get(s.agencyId)?.name ?? employeeById.get(s.employeeId ?? '')?.agencyName ?? '',
        render: (s) => agencyById.get(s.agencyId)?.name ?? employeeById.get(s.employeeId ?? '')?.agencyName ?? <span className="muted">Unknown</span>,
      },
      {
        id: 'net',
        header: 'Net (ours)',
        width: 120,
        numeric: true,
        value: (s) => s.netMargin,
        render: (s) => formatCurrency(s.netMargin),
      },
      {
        id: 'owner',
        header: 'Owner',
        width: 150,
        value: (s) => s.ownerType === 'employee'
          ? (employeeById.get(s.employeeId ?? '')?.name ?? 'Former employee')
          : 'Core Team',
        render: (s) => s.ownerType === 'employee'
          ? <span className="badge warn">{employeeById.get(s.employeeId ?? '')?.name ?? 'Former employee'}</span>
          : <span className="badge neutral">Core Team</span>,
      },
      {
        id: 'status',
        header: 'Status',
        width: 155,
        value: (s) => isAgencyPaid(s) ? 'Customer Paid' : s.status,
        render: (s) => <StatusBadge status={isAgencyPaid(s) ? 'Customer Paid' : s.status} />,
      },
      {
        id: 'agencyPayment',
        header: 'Agency payment',
        width: 235,
        value: (s) => isAgencyPaid(s) ? 'Agency paid' : 'Awaiting agency payment',
        render: (s) => {
          if (isAgencyPaid(s)) return <span className="badge success">Agency paid</span>;
          const eligibility = agencyPaymentEligibilityFor(agencyById.get(s.agencyId));
          const ready = eligibility === 'billed' ? s.status === 'Billed' : s.status === 'Customer Paid';
          return <span className={ready ? 'badge warn' : 'badge neutral'}>{ready ? 'Ready to mark paid' : eligibility === 'billed' ? 'Awaiting billing' : 'Awaiting customer payment'}</span>;
        },
      },
      // Available but off until someone turns them on — nineteen columns at once
      // is unreadable, and these matter to fewer people day to day.
      {
        id: 'transitDays',
        header: 'Transit days',
        width: 110,
        numeric: true,
        hiddenByDefault: true,
        value: (s) => s.transitDays,
        render: (s) => (s.transitDays > 0 ? String(s.transitDays) : '—'),
      },
      {
        id: 'pickup',
        header: 'Pickup',
        width: 110,
        hiddenByDefault: true,
        value: (s) => s.actualPickupDate,
        render: (s) => (s.actualPickupDate ? formatDate(s.actualPickupDate) : '—'),
      },
      {
        id: 'eta',
        header: 'Est. delivery',
        width: 120,
        hiddenByDefault: true,
        value: (s) => s.estimatedDeliveryDate,
        render: (s) => (s.estimatedDeliveryDate ? formatDate(s.estimatedDeliveryDate) : '—'),
      },
      {
        id: 'delivered',
        header: 'Delivered',
        width: 120,
        hiddenByDefault: true,
        value: (s) => s.actualDeliveryDate,
        render: (s) => (s.actualDeliveryDate ? formatDate(s.actualDeliveryDate) : '—'),
      },
      {
        id: 'invoicedDate',
        header: 'Invoice date',
        width: 120,
        hiddenByDefault: true,
        value: (s) => s.invoicedDate || s.date,
        render: (s) => formatDate(s.invoicedDate || s.date),
      },
      {
        id: 'notes',
        header: 'Notes',
        width: 200,
        hiddenByDefault: true,
        value: (s) => s.notes,
        render: (s) => s.notes || '—',
      },
    ];

    if (isAdmin) {
      list.push({
        id: 'actions',
        header: '',
        width: 90,
        locked: true,
        sortable: false,
        render: (s) => (
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn ghost small" onClick={() => setEditing(s)} aria-label="Edit">
              <Pencil size={14} />
            </button>
            <button className="btn ghost small" onClick={() => setDeleting(s)} aria-label="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        ),
      });
    }

    if (isEmployee) {
      list.splice(3, 0, {
        id: 'employeeNetBusiness',
        header: 'Net business',
        width: 150,
        numeric: true,
        value: (s) => round2(s.grossMargin * ((employeeById.get(s.employeeId ?? '')?.agencyBasisPercent ?? s.employeeCommissionBasisPercent ?? 0) / 100)),
        render: (s) => formatCurrency(round2(s.grossMargin * ((employeeById.get(s.employeeId ?? '')?.agencyBasisPercent ?? s.employeeCommissionBasisPercent ?? 0) / 100))),
      });
    }

    if (isEmployee) {
      // Employees may see operational business figures, but never the
      // internal net margin/owner split used by the core team.
      return list.filter((column) => !['net', 'owner'].includes(column.id));
    }
    return list;
  }, [agencyById, employeeById, isAdmin, isEmployee]);

  const table = useTablePrefs('shipments', user?.uid ?? '', columns);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, shipment) => {
          const split = splitShipment(shipment, data.partners);
          return {
            ar: acc.ar + shipment.ar,
            ap: acc.ap + shipment.ap,
            gross: acc.gross + shipment.grossMargin,
            net: acc.net + shipment.netMargin,
            earned: acc.earned + split.teamCommission,
          };
        },
        { ar: 0, ap: 0, gross: 0, net: 0, earned: 0 },
      ),
    [filtered, data.partners],
  );

  async function handleSave(incoming: Draft) {
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      // A load that has just been paid keeps the shares it was paid under, so a
      // later change to a partner's percentage can't re-spread earned money.
      const draft = freezeCommissionSplit(incoming, data.partners);
      const label = `${draft.loadNumber || 'Load'} · ${draft.companyName}`;
      if (editing) {
        // Operational status changes are recorded separately from agency-payment
        // events, which have their own admin-only action.
        const statusChanged = editing.status !== draft.status;
        await updateRecord(
          shipmentsCol,
          {
            entity: 'shipment',
            label,
            actor,
            id: editing.id,
            previous: editing as unknown as Record<string, unknown>,
            action: statusChanged ? 'status-changed' : 'updated',
          },
          draft,
        );
      } else {
        await createRecord(shipmentsCol, { entity: 'shipment', label, actor }, draft);
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
      await deleteRecord(shipmentsCol, {
        entity: 'shipment',
        label: `${deleting.loadNumber} · ${deleting.companyName}`,
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

  async function markSelectedAgencyPaid() {
    if (!actor || !isAdmin || eligibleSelected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(eligibleSelected.map((shipment) => {
        const paid = freezeCommissionSplit({
          ...shipment,
          agencyPaid: true,
          agencyPaidAt: bulkPaymentDate || today(),
        }, data.partners);
        return updateRecord(shipmentsCol, {
          entity: 'shipment',
          label: `${shipment.loadNumber || 'Load'} · ${shipment.companyName}`,
          actor,
          id: shipment.id,
          previous: shipment as unknown as Record<string, unknown>,
          action: 'updated',
        }, paid);
      }));
      setSelectedIds([]);
      setBulkPaymentDialog(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function markSelectedAgencyUnpaid() {
    if (!actor || !isAdmin || paidSelected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(paidSelected.map((shipment) => {
        const unpaid = {
          ...shipment,
          status: (shipment.status as string) === LEGACY_AGENCY_PAID_STATUS ? 'Customer Paid' : shipment.status,
          agencyPaid: false,
          agencyPaidAt: null,
          agencyPaidDate: null,
          commissionSplit: null,
        };
        return updateRecord(shipmentsCol, {
          entity: 'shipment',
          label: `${shipment.loadNumber || 'Load'} · ${shipment.companyName}`,
          actor,
          id: shipment.id,
          previous: shipment as unknown as Record<string, unknown>,
          action: 'updated',
        }, unpaid);
      }));
      setSelectedIds([]);
      setBulkUnpayConfirm(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sortedRows = useMemo(() => table.sortRows(filtered), [table, filtered]);

  /** Exports exactly the columns on screen, in their current order. SPEC.md §24. */
  async function exportVisible(format: 'excel' | 'pdf') {
    setExporting(format);
    setError(null);
    try {
      const exportable = table.visibleColumns.filter((column) => column.value);
      const report = {
        title: 'Shipments',
        subtitle: `${sortedRows.length} loads`,
        sheets: [
          {
            name: 'Shipments',
            columns: exportable.map((column) => ({
              header: column.header,
              numeric: column.numeric,
              currency: column.numeric,
            })),
            rows: sortedRows.map((shipment) =>
              exportable.map((column) => column.value!(shipment)),
            ),
          },
        ],
      };
      if (format === 'excel') await exportToExcel(report);
      else await exportToPdf(report);
    } catch (caught) {
      setError(`Export failed: ${(caught as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  if (data.loading) return <Spinner label="Loading shipments…" />;

  const activeFilters = Object.values(filters).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Shipments</h1>
          <p>
            {filtered.length} of {data.shipments.length} loads. Commission is earned only after an admin records the agency payment.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setColumnsOpen(true)}>
            <Columns3 size={15} />
            Columns
          </button>
          <button
            className="btn"
            onClick={() => void exportVisible('excel')}
            disabled={exporting !== null || sortedRows.length === 0}
          >
            <FileSpreadsheet size={15} />
            {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          <button
            className="btn"
            onClick={() => void exportVisible('pdf')}
            disabled={exporting !== null || sortedRows.length === 0}
          >
            <FileText size={15} />
            {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
          {(isAdmin || isEmployee) && (
            <>
              {isAdmin && <button className="btn" onClick={() => setImporting(true)}>
                <Upload size={15} />
                Import
              </button>}
              <button
                className="btn primary"
                onClick={() => setCreating(true)}
                disabled={isEmployee ? !currentEmployee?.agencyId : data.agencies.length === 0}
              >
                <Plus size={15} />
                New shipment
              </button>
            </>
          )}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {isAdmin && data.agencies.length === 0 && (
        <Banner tone="warning">
          Add an agency first — a shipment needs a commission split before it can be recorded.
        </Banner>
      )}

      <Card>
        <div className="filters">
          <MultiFilter label="Month" selected={filters.month} onChange={(value) => set('month', value)} options={months.map((value) => ({ value, label: monthLabel(value) }))} />
          {!isEmployee && <MultiFilter label="Agency" selected={filters.agency} onChange={(value) => set('agency', value)} options={data.agencies.map((row) => ({ value: row.id, label: row.name }))} />}
          <MultiFilter label="Status" selected={filters.status} onChange={(value) => set('status', value)} options={(isEmployee ? ['Assigned', 'In Transit', 'Delivered'] : SHIPMENT_STATUSES).map((value) => ({ value, label: value }))} />
          {!isEmployee && <MultiFilter label="Agency payment" selected={filters.agencyPayment} onChange={(value) => set('agencyPayment', value)} options={[{ value: 'paid', label: 'Agency paid' }, { value: 'unpaid', label: 'Awaiting agency payment' }]} />}
          <MultiFilter label="Type" selected={filters.type} onChange={(value) => set('type', value)} options={SHIPMENT_TYPES.map((value) => ({ value, label: value }))} />
          <MultiFilter label="Customer" selected={filters.customer} onChange={(value) => set('customer', value)} options={customers.map((value) => ({ value, label: value }))} />
          <MultiFilter label="Carrier" selected={filters.carrier} onChange={(value) => set('carrier', value)} options={carriers.map((value) => ({ value, label: value }))} />
          <MultiFilter label="Lane" selected={filters.lane} onChange={(value) => set('lane', value)} options={lanes.map((value) => ({ value, label: value }))} />
          {!isEmployee && <MultiFilter label="Shipment owner" selected={filters.owner} onChange={(value) => set('owner', value)} options={[
            { value: 'core-team', label: 'Core Team' },
            ...data.employees.map((employee) => ({ value: `employee:${employee.id}`, label: employee.name })),
          ]} />}
          <Field label="Search">
            <input
              placeholder="Company, load #, POC…"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
            />
          </Field>
          <button className="btn" onClick={() => setFilters(NO_FILTERS)} disabled={activeFilters === 0}>
            <RotateCcw size={14} />
            Clear
          </button>
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <Card flush>
        {isAdmin && selectedIds.length > 0 && <div className="bulk-action-bar">
          <strong>{selectedIds.length} shipment{selectedIds.length === 1 ? '' : 's'} selected</strong>
          <span className="muted">{eligibleSelected.length} ready to mark paid · {paidSelected.length} already paid</span>
          <div className="page-actions">
            <button className="btn primary" disabled={eligibleSelected.length === 0 || busy} onClick={() => { setBulkPaymentDate(today()); setBulkPaymentDialog(true); }}>
              Mark selected paid
            </button>
            <button className="btn danger" disabled={paidSelected.length === 0 || busy} onClick={() => setBulkUnpayConfirm(true)}>
              Mark selected unpaid
            </button>
            <button className="btn" disabled={busy} onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        </div>}
        <DataTable
          table={table}
          rows={sortedRows}
          rowKey={(shipment) => shipment.id}
          onRowClick={(shipment) => navigate(`/shipments/${shipment.id}`)}
          selectable={isAdmin}
          selectedIds={selectedIds}
          rowId={(shipment) => shipment.id}
          onToggleRow={(shipment) => setSelectedIds((ids) => ids.includes(shipment.id) ? ids.filter((id) => id !== shipment.id) : [...ids, shipment.id])}
          onToggleAll={() => {
            const visibleIds = sortedRows.map((shipment) => shipment.id);
            setSelectedIds((ids) => visibleIds.every((id) => ids.includes(id))
              ? ids.filter((id) => !visibleIds.includes(id))
              : [...new Set([...ids, ...visibleIds])]);
          }}
          emptyTitle={data.shipments.length === 0 ? 'No shipments yet' : 'No matches'}
          emptyMessage={
            data.shipments.length === 0
              ? 'Record a load, or use Import to bring in a spreadsheet.'
              : 'Try clearing a filter.'
          }
          footer={
            filtered.length > 0 && !isEmployee ? (
              <tfoot>
                <tr>
                  <td colSpan={Math.max(1, table.visibleColumns.length)}>
                    {filtered.length} loads · AR {formatCurrency(totals.ar)} · gross{' '}
                    {formatCurrency(totals.gross)} · net {formatCurrency(totals.net)} ·{' '}
                    {formatCurrency(totals.earned)} earned
                  </td>
                </tr>
              </tfoot>
            ) : undefined
          }
        />
      </Card>

      {columnsOpen && <ColumnManager table={table} onClose={() => setColumnsOpen(false)} />}

      {(creating || editing) && (
        <ShipmentForm
          initial={editing ?? (isEmployee
            ? {
                ...emptyDraft(currentEmployee?.agencyId ?? ''),
                ownerType: 'employee',
                employeeId: currentEmployee?.id ?? employeeId ?? null,
              }
            : emptyDraft(data.agencies[0]?.id ?? ''))}
          isEmployee={isEmployee}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      {importing && <BulkImport onClose={() => setImporting(false)} />}

      {bulkPaymentDialog && <Modal
        narrow
        title="Record agency payments"
        onClose={() => setBulkPaymentDialog(false)}
        footer={<>
          <button className="btn" onClick={() => setBulkPaymentDialog(false)} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={() => void markSelectedAgencyPaid()} disabled={busy || !bulkPaymentDate}>
            {busy ? 'Saving…' : `Mark ${eligibleSelected.length} paid`}
          </button>
        </>}
      >
        <Field label="Agency payment date" help="Defaults to today. This date will be applied to every eligible selected shipment.">
          <input type="date" value={bulkPaymentDate} onChange={(event) => setBulkPaymentDate(event.target.value)} />
        </Field>
        {eligibleSelected.length < selectedShipments.length && <p className="help">Only shipments that meet their agency's payment rule will be updated. Other selected shipments will be skipped.</p>}
      </Modal>}

      {bulkUnpayConfirm && <ConfirmDialog
        title="Mark agency payments unpaid?"
        message={`This will reverse agency payment for ${paidSelected.length} selected shipment${paidSelected.length === 1 ? '' : 's'} and remove their frozen commission split. Their shipment status will remain unchanged.`}
        confirmLabel="Mark unpaid"
        onConfirm={() => void markSelectedAgencyUnpaid()}
        onCancel={() => setBulkUnpayConfirm(false)}
        busy={busy}
      />}

      {deleting && (
        <ConfirmDialog
          title="Delete shipment"
          message={`Delete load ${deleting.loadNumber || '(no number)'} for ${
            deleting.companyName
          }? This removes its commission from every partner's balance.`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

function MultiFilter({
  label, options, selected, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  const toggle = (value: string) => onChange(
    selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
  );
  return <div className="multi-filter" ref={containerRef}>
    <span className="multi-filter-label">{label}</span>
    <button type="button" className="multi-filter-trigger" onClick={() => setOpen((value) => !value)}>
      <span>{selected.length === 0 ? `All ${label.toLowerCase()}s` : `${selected.length} selected`}</span>
      <ChevronDown size={15} />
    </button>
    {open && <div className="multi-filter-menu">
      <div className="multi-filter-menu-head"><span>{label}</span>{selected.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}</div>
      {options.length === 0 ? <span className="muted">No options</span> : options.map((option) => <label key={option.value} className="multi-filter-option">
        <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>}
  </div>;
}

export function ShipmentForm({
  initial,
  isEmployee,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft | Shipment;
  isEmployee: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const data = useData();
  const [draft, setDraft] = useState<Draft>({ ...(initial as Draft) });
  const isNew = !('id' in initial);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const agency = data.agencies.find((a) => a.id === draft.agencyId);
  const employee = data.employees.find((row) => row.id === draft.employeeId);
  const customer = data.customers.find((row) => row.id === draft.customerId);

  // A customer's assignment decides which brokerages this load may run under.
  const allowedAgencies = useMemo(
    () => agenciesForCustomer(customer, data.agencies),
    [customer, data.agencies],
  );

  // Our share is always derived — never typed in — so the stored figure can't
  // disagree with the agency split it came from.
  const netMargin = useMemo(
    () => computeNetMargin(draft.grossMargin, agency),
    [draft.grossMargin, agency],
  );

  // Previewed so the due date is visible before saving.
  const dueDate = useMemo(() => {
    const start = draft.invoicedDate || draft.date;
    if (!start) return '';
    return addDays(start, customer?.paymentTermsDays ?? 30);
  }, [draft.invoicedDate, draft.date, customer]);

  // LTL counts business days, FTL calendar days. Offered rather than forced, so
  // a quoted date that differs from the arithmetic can still be recorded.
  const estimatedDelivery = useMemo(
    () => estimateDelivery(draft.actualPickupDate, draft.transitDays, draft.shipmentType),
    [draft.actualPickupDate, draft.transitDays, draft.shipmentType],
  );

  const performance = deliveryPerformance(draft);

  const preview = useMemo(
    () =>
      splitShipment(
        { ...draft, id: 'preview', netMargin, agencyPaid: true } as Shipment,
        data.partners,
      ),
    [draft, netMargin, data.partners],
  );

  const impliedGross = round2(draft.ar - draft.ap);
  const grossMismatch =
    (draft.ar !== 0 || draft.ap !== 0) && Math.abs(impliedGross - draft.grossMargin) > 0.005;

  function submit() {
    onSave({
      ...draft,
      month: monthOf(draft.date),
      netMargin,
      customerPaidAt: draft.status === 'Customer Paid' ? (draft.customerPaidAt || today()) : (draft.customerPaidAt ?? null),
      // Freeze employee terms on the shipment so later admin changes do not
      // alter a settlement that has already been assigned.
      employeeCommissionTiers: draft.ownerType === 'employee'
        ? (draft.employeeCommissionTiers ?? employee?.commissionTiers ?? [])
        : null,
      employeeMaxCommissionPercent: draft.ownerType === 'employee'
        ? (draft.employeeMaxCommissionPercent ?? employee?.maxCommissionPercent ?? 0)
        : null,
      // This is intentionally captured per load: a later change to the
      // employee-facing split cannot rewrite an already agreed settlement.
      employeeCommissionBasisPercent: draft.ownerType === 'employee'
        ? (draft.employeeCommissionBasisPercent ?? employee?.agencyBasisPercent ?? agency?.employeeCommissionBasisPercent ?? agency?.agentPercent ?? null)
        : null,
      employeeId: draft.ownerType === 'employee' ? draft.employeeId : null,
    });
  }

  // A load can't be Billed without saying when it was billed — the receivable's
  // due date is worked out from that date, not from the load date.
  const needsInvoiceDate = draft.status === BILLED_STATUS && !draft.invoicedDate;

  const valid =
    draft.companyName.trim().length > 0 && draft.agencyId.length > 0 && !needsInvoiceDate
    && (draft.ownerType !== 'employee' || (Boolean(draft.employeeId) && Boolean(draft.customerId)));

  // Employees can progress their own load through the operational statuses.
  // Billing, customer payment and agency payment remain admin-only.
  if (isEmployee && !isNew) {
    const employeeStatusOptions: ShipmentStatus[] = draft.status === 'Assigned'
      ? ['Assigned', 'In Transit']
      : draft.status === 'In Transit'
        ? ['In Transit', 'Delivered']
        : [draft.status];
    const canUpdateStatus = employeeStatusOptions.length > 1;
    const submitEmployeeUpdate = () => onSave({
      ...draft,
      actualPickupDate: draft.status === 'In Transit' && !draft.actualPickupDate ? today() : draft.actualPickupDate,
      actualDeliveryDate: draft.status === 'Delivered' && !draft.actualDeliveryDate ? today() : draft.actualDeliveryDate,
    });
    return <Modal
      narrow
      title="Update shipment status"
      onClose={onCancel}
      footer={<><button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>{canUpdateStatus && <button className="btn primary" onClick={submitEmployeeUpdate} disabled={busy}>{busy ? 'Saving…' : 'Save status'}</button>}</>}
    >
      <div className="partner-rows">
        <div><span>Load</span><strong>{draft.loadNumber || '—'}</strong></div>
        <div><span>Customer</span><strong>{draft.companyName || '—'}</strong></div>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(event) => {
              const status = event.target.value as ShipmentStatus;
              setDraft((current) => ({
                ...current,
                status,
                actualPickupDate: status === 'In Transit' && !current.actualPickupDate ? today() : current.actualPickupDate,
                actualDeliveryDate: status === 'Delivered' && !current.actualDeliveryDate ? today() : current.actualDeliveryDate,
              }));
            }}
          >
            {employeeStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </Field>
      </div>
      {draft.status === 'In Transit' && <Field label="Actual pickup date">
        <input type="date" value={draft.actualPickupDate} onChange={(event) => set('actualPickupDate', event.target.value)} />
      </Field>}
      {draft.status === 'Delivered' && <Field label="Actual delivery date">
          <input type="date" value={draft.actualDeliveryDate} onChange={(e) => set('actualDeliveryDate', e.target.value)} />
      </Field>}
      {canUpdateStatus ? <p className="help">Employees can update pickup and delivery progress. Billing, customer payment and agency payment are completed by an administrator.</p> : <Banner tone="info">This shipment is already delivered or has progressed beyond delivery. Only an administrator can make further changes.</Banner>}
    </Modal>;
  }

  return (
    <Modal
      title={'id' in initial ? 'Edit shipment' : 'New shipment'}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save shipment'}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Date">
          <input
            type="date"
            value={draft.date}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, date: e.target.value, month: monthOf(e.target.value) }))
            }
          />
        </Field>
        <Field label="Month" help="Set automatically from the date.">
          <input value={monthLabel(draft.month)} readOnly />
        </Field>
        <Field label="Load number">
          <input value={draft.loadNumber} onChange={(e) => set('loadNumber', e.target.value)} />
        </Field>
        <Field label="Shipment type">
          <select
            value={draft.shipmentType}
            onChange={(e) => set('shipmentType', e.target.value as ShipmentType)}
          >
            {SHIPMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === 'LTL' ? 'LTL — less than truckload' : 'FTL — full truckload'}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field-row">
        <Field
          label="Customer"
          help={
            customer
              ? `${paymentTermsLabel(customer.paymentTermsDays)} — sets this load's invoice due date.`
              : 'Pick a customer to apply their payment terms and agencies.'
          }
        >
          <select
            value={draft.customerId}
            onChange={(e) => {
              const picked = data.customers.find((row) => row.id === e.target.value);
              setDraft((prev) => {
                const allowed = agenciesForCustomer(picked, data.agencies);
                const keepAgency = isEmployee || allowed.some((agency) => agency.id === prev.agencyId);
                return {
                  ...prev,
                  customerId: e.target.value,
                  // Copy the customer's details across, but never overwrite
                  // something already typed for this load.
                  companyName: picked?.companyName ?? prev.companyName,
                  poc: prev.poc || (picked?.poc ?? ''),
                  agencyId: keepAgency ? prev.agencyId : (allowed[0]?.id ?? ''),
                };
              });
            }}
          >
            <option value="">No customer linked</option>
            {data.customers
              .filter((row) => row.active || row.id === draft.customerId)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.companyName}
                  {row.active ? '' : ' — inactive'}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Company name" help="Shown on reports. Filled from the customer.">
          <input
            value={draft.companyName}
            onChange={(e) => set('companyName', e.target.value)}
            required
          />
        </Field>
        <Field label="POC">
          <input value={draft.poc} onChange={(e) => set('poc', e.target.value)} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Lane" help="e.g. Chicago, IL → Dallas, TX">
          <input value={draft.lane} onChange={(e) => set('lane', e.target.value)} />
        </Field>
        <Field label="Carrier name">
          <input value={draft.carrierName} onChange={(e) => set('carrierName', e.target.value)} />
        </Field>
      </div>

      <div className="field-row">
        <Field label="AR (customer pays)">
          <input
            type="number"
            step="0.01"
            value={draft.ar}
            onChange={(e) => {
              const ar = Number(e.target.value);
              setDraft((prev) => ({ ...prev, ar, grossMargin: round2(ar - prev.ap) }));
            }}
          />
        </Field>
        <Field label="AP (carrier paid)">
          <input
            type="number"
            step="0.01"
            value={draft.ap}
            onChange={(e) => {
              const ap = Number(e.target.value);
              setDraft((prev) => ({ ...prev, ap, grossMargin: round2(prev.ar - ap) }));
            }}
          />
        </Field>
        <Field label="Gross business" help="AR − AP. The whole business margin before any agency split.">
          <input
            type="number"
            step="0.01"
            value={draft.grossMargin}
            onChange={(e) => set('grossMargin', Number(e.target.value))}
          />
        </Field>
      </div>

      {isEmployee && isNew && (
        <Banner tone="info">
          New employee shipments start as <strong>Assigned</strong>. After saving, you can mark your own load Delivered; all later statuses are set by an administrator.
        </Banner>
      )}

      {!isEmployee && grossMismatch && (
        <Banner tone="info">
          <span>
            Gross margin doesn't match AR − AP ({formatCurrency(impliedGross)}).{' '}
            <button className="btn small" onClick={() => set('grossMargin', impliedGross)}>
              Use {formatCurrency(impliedGross)}
            </button>
          </span>
        </Banner>
      )}

      {isEmployee && (
        <Banner tone="info">
          Employee net business: {formatCurrency(round2(draft.grossMargin * ((employee?.agencyBasisPercent ?? draft.employeeCommissionBasisPercent ?? 0) / 100)))}
        </Banner>
      )}

      {!isEmployee && <div className="field-row">
        <Field
          label="Agency"
          help={
            customer && customer.agencyIds.length > 0
              ? `Narrowed to the agencies assigned to ${customer.companyName}.`
              : undefined
          }
        >
          <select value={draft.agencyId} onChange={(e) => {
            const agencyId = e.target.value;
            const picked = data.agencies.find((row) => row.id === agencyId);
            setDraft((prev) => ({
              ...prev,
              agencyId,
              employeeCommissionBasisPercent: prev.ownerType === 'employee'
                ? (picked?.employeeCommissionBasisPercent ?? picked?.agentPercent ?? null)
                : prev.employeeCommissionBasisPercent,
            }));
          }}>
            <option value="">Select an agency…</option>
            {allowedAgencies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.agentPercent}/{a.agencyPercent})
              </option>
            ))}
            {/* Keep the current agency selectable even if it's since been
                deactivated or unassigned, so editing an old load doesn't
                silently switch its split. */}
            {agency && !allowedAgencies.some((a) => a.id === agency.id) && (
              <option value={agency.id}>
                {agency.name} ({agency.agentPercent}/{agency.agencyPercent}) — not assigned
              </option>
            )}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(e) => {
              const status = e.target.value as ShipmentStatus;
              setDraft((prev) => ({
                ...prev,
                status,
                customerPaidAt:
                  status === 'Customer Paid' && prev.status !== 'Customer Paid'
                    ? today()
                    : prev.customerPaidAt,
                // Completed hands the load to accounting and Billed means they
                // have raised the invoice — either way the payment clock starts,
                // so stamp the date if it isn't already set.
                invoicedDate:
                  (status === 'Completed' || status === BILLED_STATUS) && !prev.invoicedDate
                    ? today()
                    : prev.invoicedDate,
              }));
            }}
          >
            {SHIPMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shipment owner">
          <select
            value={draft.ownerType ?? 'core-team'}
            onChange={(e) => {
              const ownerType = e.target.value as 'core-team' | 'employee';
              setDraft((prev) => ({
                ...prev,
                ownerType,
                employeeId: ownerType === 'employee' ? prev.employeeId : null,
                employeeCommissionTiers: ownerType === 'employee' ? prev.employeeCommissionTiers : null,
                employeeMaxCommissionPercent: ownerType === 'employee' ? prev.employeeMaxCommissionPercent : null,
                employeeCommissionBasisPercent: ownerType === 'employee' ? prev.employeeCommissionBasisPercent : null,
              }));
            }}
          >
            <option value="core-team">Core Team Shipment</option>
            <option value="employee">Employee Shipment</option>
          </select>
        </Field>
      </div>}

      {!isEmployee && draft.ownerType === 'employee' && (
        <Field label="Commission employee" help="The current commission rate and monthly cap are captured with this shipment.">
          <select
            value={draft.employeeId ?? ''}
            onChange={(e) => {
              const picked = data.employees.find((row) => row.id === e.target.value);
              setDraft((prev) => ({
                ...prev,
                employeeId: e.target.value || null,
                employeeCommissionTiers: picked?.commissionTiers ?? null,
                employeeMaxCommissionPercent: picked?.maxCommissionPercent ?? null,
                employeeCommissionBasisPercent: agency?.employeeCommissionBasisPercent ?? agency?.agentPercent ?? null,
              }));
            }}
          >
            <option value="">Select an employee…</option>
            {data.employees.filter((row) => row.active || row.id === draft.employeeId).map((row) => (
              <option key={row.id} value={row.id}>{row.name}{row.active ? '' : ' — disabled'}</option>
            ))}
          </select>
        </Field>
      )}

      {draft.status === 'Completed' && (
        <Banner tone="info">
          Marked Completed — POD is in the TMS and the load is ready for your accounting team to
          invoice. The portal doesn't issue the invoice; it just starts tracking when payment falls
          due{dueDate ? ` (${formatDate(dueDate)})` : ''}.
        </Banner>
      )}

      {draft.status === BILLED_STATUS && (
        <Banner tone={needsInvoiceDate ? 'warning' : 'info'}>
          {needsInvoiceDate
            ? 'Marked Billed — record the date the customer was invoiced before saving.'
            : `Marked Billed — invoiced to the customer on ${formatDate(draft.invoicedDate)}${
                dueDate ? `, due ${formatDate(dueDate)}` : ''
              }. Commission is still pending until an administrator records the agency payment.`}
        </Banner>
      )}

      {draft.status === 'Customer Paid' && !isEmployee && (
        <Field label="Customer payment date" help="Defaults to today. Change it when the customer payment was received on another date.">
          <input
            type="date"
            value={draft.customerPaidAt || today()}
            onChange={(e) => set('customerPaidAt', e.target.value)}
          />
        </Field>
      )}

      {!isEmployee && <Field
        label={draft.status === BILLED_STATUS ? 'Invoice date — required' : 'Invoice date'}
        help={
          dueDate
            ? `Billed as ${draft.loadNumber || 'this load number'} — due ${formatDate(dueDate)} on ${paymentTermsLabel(customer?.paymentTermsDays ?? 30)}.`
            : draft.status === BILLED_STATUS
              ? 'The date accounting invoiced the customer.'
              : 'Defaults to the load date when blank.'
        }
      >
        <input
          type="date"
          value={draft.invoicedDate}
          required={draft.status === BILLED_STATUS}
          onChange={(e) => set('invoicedDate', e.target.value)}
        />
      </Field>}

      <Card title="Transit">
        <div className="field-row">
          <Field label="Actual pickup date">
            <input
              type="date"
              value={draft.actualPickupDate}
              onChange={(e) => setDraft((prev) => ({ ...prev, actualPickupDate: e.target.value }))}
            />
          </Field>
          <Field
            label="Transit days"
            help={
              draft.shipmentType === 'LTL'
                ? 'Business days — weekends are skipped.'
                : 'Calendar days — weekends count.'
            }
          >
            <input
              type="number"
              min={0}
              value={draft.transitDays}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, transitDays: Math.max(0, Number(e.target.value)) }))
              }
            />
          </Field>
          <Field
            label="Estimated delivery"
            help={
              estimatedDelivery && draft.estimatedDeliveryDate !== estimatedDelivery
                ? `Calculated: ${formatDate(estimatedDelivery)}`
                : 'Calculated from pickup and transit days.'
            }
          >
            <input
              type="date"
              value={draft.estimatedDeliveryDate}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, estimatedDeliveryDate: e.target.value }))
              }
            />
          </Field>
          <Field label="Actual delivery date">
            <input
              type="date"
              value={draft.actualDeliveryDate}
              onChange={(e) => setDraft((prev) => ({ ...prev, actualDeliveryDate: e.target.value }))}
            />
          </Field>
        </div>

        {estimatedDelivery && draft.estimatedDeliveryDate !== estimatedDelivery && (
          <Banner tone="info">
            <span>
              {draft.shipmentType} picked up {formatDate(draft.actualPickupDate)} with{' '}
              {draft.transitDays} {draft.shipmentType === 'LTL' ? 'business' : 'calendar'} day
              {draft.transitDays === 1 ? '' : 's'} transit delivers{' '}
              <strong>{formatDate(estimatedDelivery)}</strong>.{' '}
              <button
                className="btn small"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, estimatedDeliveryDate: estimatedDelivery }))
                }
              >
                Use it
              </button>
            </span>
          </Banner>
        )}

        {performance.state === 'late' && (
          <Banner tone="warning">
            Delivered {performance.daysDifference} day
            {performance.daysDifference === 1 ? '' : 's'} later than estimated.
          </Banner>
        )}
      </Card>

      <Field label="Notes">
        <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      {agency && draft.grossMargin !== 0 && (
        <Card title={draft.agencyPaid ? 'Commission' : 'Commission after agency payment'}>
          <div className="partner-rows">
            <div>
              <span>Gross margin</span>
              <span>{formatCurrency(draft.grossMargin)}</span>
            </div>
            <div>
              <span>
                {agency.name} keeps ({agency.agencyPercent}%)
              </span>
              <span>−{formatCurrency(round2(draft.grossMargin - netMargin))}</span>
            </div>
            <div className="total">
              <span>Net margin — our share ({agency.agentPercent}%)</span>
              <span>{formatCurrency(netMargin)}</span>
            </div>
            {draft.ownerType === 'employee' && (
              <div>
                <span>{employee?.name ?? 'Employee'} commission basis</span>
                <span>{draft.employeeCommissionBasisPercent ?? agency.agentPercent}% of gross margin; final monthly tier applies</span>
              </div>
            )}
            {draft.ownerType !== 'employee' && data.partners
              .filter((partner) => partner.active)
              .map((partner) => (
                <div key={partner.id}>
                  <span>
                    {partner.name} · {partner.sharePercent}%
                  </span>
                  <span>{formatCurrency(preview.partnerEarnings[partner.id] ?? 0)}</span>
                </div>
              ))}
          </div>
          {!draft.agencyPaid && (
            <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
              Nothing is credited to anyone until an administrator marks the agency payment received.
            </p>
          )}
        </Card>
      )}
    </Modal>
  );
}

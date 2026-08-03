import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Columns3,
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
  SHIPMENT_STATUSES,
  SHIPMENT_TYPES,
  paymentTermsLabel,
  type Shipment,
  type ShipmentStatus,
  type ShipmentType,
} from '@/domain/types';
import { computeNetMargin, freezeCommissionSplit, splitShipment } from '@/domain/engine';
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

type Draft = Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>;

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
    invoicedDate: '',
    transitDays: 0,
    actualPickupDate: '',
    estimatedDeliveryDate: '',
    actualDeliveryDate: '',
    notes: '',
  };
}

const NO_FILTERS = {
  month: '',
  agency: '',
  status: '',
  type: '',
  customer: '',
  carrier: '',
  lane: '',
  search: '',
};

/** Distinct non-empty values of a field, alphabetised, for the filter dropdowns. */
function distinctValues(shipments: Shipment[], pick: (shipment: Shipment) => string): string[] {
  return [...new Set(shipments.map(pick).map((value) => value.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export default function Shipments({ openCreate = false }: { openCreate?: boolean }) {
  const { isAdmin, actor, user } = useAuth();
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

  const set = <K extends keyof typeof NO_FILTERS>(key: K, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const agencyById = useMemo(
    () => new Map(data.agencies.map((agency) => [agency.id, agency])),
    [data.agencies],
  );

  const months = useMemo(() => distinctMonths(data.shipments), [data.shipments]);
  const customers = useMemo(() => distinctValues(data.shipments, (s) => s.companyName), [data.shipments]);
  const carriers = useMemo(() => distinctValues(data.shipments, (s) => s.carrierName), [data.shipments]);
  const lanes = useMemo(() => distinctValues(data.shipments, (s) => s.lane), [data.shipments]);

  const filtered = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return data.shipments.filter((shipment) => {
      if (filters.month && shipment.month !== filters.month) return false;
      if (filters.agency && shipment.agencyId !== filters.agency) return false;
      if (filters.status && shipment.status !== filters.status) return false;
      if (filters.type && shipment.shipmentType !== filters.type) return false;
      if (filters.customer && shipment.companyName !== filters.customer) return false;
      if (filters.carrier && shipment.carrierName !== filters.carrier) return false;
      if (filters.lane && shipment.lane !== filters.lane) return false;
      if (!needle) return true;
      return [shipment.companyName, shipment.loadNumber, shipment.lane, shipment.carrierName, shipment.poc]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [data.shipments, filters]);

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
        width: 130,
        value: (s) => s.loadNumber,
        render: (s) => (
          <Link
            to={`/shipments/${s.id}`}
            className="mono"
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}
          >
            {s.loadNumber || 'View'}
          </Link>
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
        header: 'Gross',
        width: 110,
        numeric: true,
        value: (s) => s.grossMargin,
        render: (s) => formatCurrency(s.grossMargin),
      },
      {
        id: 'agency',
        header: 'Agency',
        width: 150,
        value: (s) => agencyById.get(s.agencyId)?.name ?? '',
        render: (s) => agencyById.get(s.agencyId)?.name ?? <span className="muted">Unknown</span>,
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
        id: 'status',
        header: 'Status',
        width: 130,
        value: (s) => s.status,
        render: (s) => <StatusBadge status={s.status} />,
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

    return list;
  }, [agencyById, isAdmin]);

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
        // A move into or out of 'Agency Paid' changes the money, so the audit
        // log records it as a status change rather than a generic edit.
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

  const activeFilters = Object.values(filters).filter(Boolean).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Shipments</h1>
          <p>
            {filtered.length} of {data.shipments.length} loads. Commission is only earned at{' '}
            <strong>Agency Paid</strong>.
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
          {isAdmin && (
            <>
              <button className="btn" onClick={() => setImporting(true)}>
                <Upload size={15} />
                Import
              </button>
              <button
                className="btn primary"
                onClick={() => setCreating(true)}
                disabled={data.agencies.length === 0}
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
          <Field label="Month">
            <select value={filters.month} onChange={(e) => set('month', e.target.value)}>
              <option value="">All months</option>
              {months.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Agency">
            <select value={filters.agency} onChange={(e) => set('agency', e.target.value)}>
              <option value="">All agencies</option>
              {data.agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={filters.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">All statuses</option>
              {SHIPMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={filters.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">LTL and FTL</option>
              {SHIPMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Customer">
            <select value={filters.customer} onChange={(e) => set('customer', e.target.value)}>
              <option value="">All customers</option>
              {customers.map((customer) => (
                <option key={customer} value={customer}>
                  {customer}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Carrier">
            <select value={filters.carrier} onChange={(e) => set('carrier', e.target.value)}>
              <option value="">All carriers</option>
              {carriers.map((carrier) => (
                <option key={carrier} value={carrier}>
                  {carrier}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lane">
            <select value={filters.lane} onChange={(e) => set('lane', e.target.value)}>
              <option value="">All lanes</option>
              {lanes.map((lane) => (
                <option key={lane} value={lane}>
                  {lane}
                </option>
              ))}
            </select>
          </Field>
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
        <DataTable
          table={table}
          rows={sortedRows}
          rowKey={(shipment) => shipment.id}
          onRowClick={(shipment) => navigate(`/shipments/${shipment.id}`)}
          emptyTitle={data.shipments.length === 0 ? 'No shipments yet' : 'No matches'}
          emptyMessage={
            data.shipments.length === 0
              ? 'Record a load, or use Import to bring in a spreadsheet.'
              : 'Try clearing a filter.'
          }
          footer={
            filtered.length > 0 ? (
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
          initial={editing ?? emptyDraft(data.agencies[0]?.id ?? '')}
          isAdmin={isAdmin}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      {importing && <BulkImport onClose={() => setImporting(false)} />}

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

function ShipmentForm({
  initial,
  isAdmin,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft | Shipment;
  isAdmin: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const data = useData();
  const [draft, setDraft] = useState<Draft>({ ...(initial as Draft) });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const agency = data.agencies.find((a) => a.id === draft.agencyId);
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
        { ...draft, id: 'preview', netMargin, status: 'Agency Paid' } as Shipment,
        data.partners,
      ),
    [draft, netMargin, data.partners],
  );

  const impliedGross = round2(draft.ar - draft.ap);
  const grossMismatch =
    (draft.ar !== 0 || draft.ap !== 0) && Math.abs(impliedGross - draft.grossMargin) > 0.005;

  function submit() {
    onSave({ ...draft, month: monthOf(draft.date), netMargin });
  }

  // A load can't be Billed without saying when it was billed — the receivable's
  // due date is worked out from that date, not from the load date.
  const needsInvoiceDate = draft.status === BILLED_STATUS && !draft.invoicedDate;

  const valid =
    draft.companyName.trim().length > 0 && draft.agencyId.length > 0 && !needsInvoiceDate;

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
                const keepAgency = allowed.some((agency) => agency.id === prev.agencyId);
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
        <Field label="Gross margin" help="AR − AP. The whole margin, before the agency's cut.">
          <input
            type="number"
            step="0.01"
            value={draft.grossMargin}
            onChange={(e) => set('grossMargin', Number(e.target.value))}
          />
        </Field>
      </div>

      {grossMismatch && (
        <Banner tone="info">
          <span>
            Gross margin doesn't match AR − AP ({formatCurrency(impliedGross)}).{' '}
            <button className="btn small" onClick={() => set('grossMargin', impliedGross)}>
              Use {formatCurrency(impliedGross)}
            </button>
          </span>
        </Banner>
      )}

      <div className="field-row">
        <Field
          label="Agency"
          help={
            customer && customer.agencyIds.length > 0
              ? `Narrowed to the agencies assigned to ${customer.companyName}.`
              : undefined
          }
        >
          <select value={draft.agencyId} onChange={(e) => set('agencyId', e.target.value)}>
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
            {SHIPMENT_STATUSES.filter((status) => isAdmin || status !== 'Agency Paid').map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
      </div>

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
              }. Commission is still only earned at Agency Paid.`}
        </Banner>
      )}

      <Field
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
      </Field>

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
        <Card title={draft.status === 'Agency Paid' ? 'Commission' : 'Commission once Agency Paid'}>
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
            {data.partners
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
          {draft.status !== 'Agency Paid' && (
            <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
              Nothing is credited to anyone until this shipment is marked Agency Paid.
            </p>
          )}
        </Card>
      )}
    </Modal>
  );
}

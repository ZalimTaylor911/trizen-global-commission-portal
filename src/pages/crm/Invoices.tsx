import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, FileSpreadsheet, FileText, RotateCcw } from 'lucide-react';
import { useData } from '@/context/DataContext';
import {
  computeArSummary,
  computeReceivables,
  openReceivables,
  type Receivable,
} from '@/domain/receivables';
import { formatCurrency, round2 } from '@/domain/money';
import { paymentTermsLabel } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPdf } from '@/lib/export/pdf';
import type { ReportDocument } from '@/lib/export/types';
import { Banner, Card, Field, Spinner, Tile } from '@/components/ui';
import ReceivableTable from './ReceivableTable';

type View = 'outstanding' | 'due-soon' | 'overdue' | 'paid';

const TABS: { id: View; label: string }[] = [
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'due-soon', label: 'Due soon' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' },
];

const BLURB: Record<View, string> = {
  outstanding: 'Every load handed to accounting for invoicing that the customer has not yet paid.',
  'due-soon': 'Falling due within the next seven days — worth a courtesy chase.',
  overdue: 'Past their due date and still unpaid. Oldest first.',
  paid: 'Settled by the customer. Kept for reference and statements.',
};

function isView(value: string | null): value is View {
  return TABS.some((tab) => tab.id === value);
}

export default function Invoices() {
  const data = useData();
  const [params, setParams] = useSearchParams();

  const view: View = isView(params.get('view')) ? (params.get('view') as View) : 'outstanding';
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receivables = useMemo(
    () => computeReceivables(data.shipments, data.customers),
    [data.shipments, data.customers],
  );
  const summary = useMemo(() => computeArSummary(receivables), [receivables]);

  const rows = useMemo(() => {
    const open = openReceivables(receivables);
    let base: Receivable[];

    switch (view) {
      case 'overdue':
        base = open.filter((r) => r.state === 'overdue').sort((a, b) => b.daysPastDue - a.daysPastDue);
        break;
      case 'due-soon':
        base = open
          .filter((r) => r.daysUntilDue >= 0 && r.daysUntilDue <= 7)
          .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
        break;
      case 'paid':
        base = receivables
          .filter((r) => r.state === 'settled')
          .sort((a, b) => b.invoicedDate.localeCompare(a.invoicedDate));
        break;
      default:
        base = open;
    }

    const needle = search.trim().toLowerCase();
    return base.filter((row) => {
      if (customerId && row.customerId !== customerId) return false;
      if (!needle) return true;
      return `${row.customerName} ${row.loadNumber}`.toLowerCase().includes(needle);
    });
  }, [receivables, view, customerId, search]);

  const total = round2(rows.reduce((sum, row) => sum + row.amount, 0));
  const oldest = rows.reduce((worst, row) => Math.max(worst, row.daysPastDue), 0);
  const customer = data.customers.find((row) => row.id === customerId);

  const report: ReportDocument = useMemo(
    () => ({
      title: customer ? `Statement — ${customer.companyName}` : 'AR Ageing',
      subtitle: customer
        ? `${TABS.find((tab) => tab.id === view)?.label} · terms ${paymentTermsLabel(customer.paymentTermsDays)}`
        : `${TABS.find((tab) => tab.id === view)?.label} · ${rows.length} invoices`,
      summary: [
        { label: 'Invoices', value: String(rows.length) },
        { label: 'Total', value: formatCurrency(total) },
        {
          label: 'Overdue',
          value: formatCurrency(
            round2(rows.filter((r) => r.state === 'overdue').reduce((sum, r) => sum + r.amount, 0)),
          ),
        },
      ],
      sheets: [
        {
          name: 'Invoices',
          columns: [
            { header: 'Customer' },
            { header: 'Invoice / Load #' },
            { header: 'Invoice Date' },
            { header: 'Due Date' },
            { header: 'Terms' },
            { header: 'Days Past Due', numeric: true },
            { header: 'Amount', numeric: true, currency: true },
          ],
          rows: rows.map((row) => [
            row.customerName,
            row.loadNumber,
            formatDate(row.invoicedDate),
            formatDate(row.dueDate),
            row.paymentTermsDays === 0 ? 'On receipt' : `Net ${row.paymentTermsDays}`,
            row.daysPastDue,
            round2(row.amount),
          ]),
          totals: [`${rows.length} invoices`, null, null, null, null, null, total],
        },
      ],
    }),
    [rows, total, customer, view],
  );

  async function runExport(format: 'excel' | 'pdf') {
    setExporting(format);
    setMessage(null);
    setError(null);
    try {
      const result = format === 'excel' ? await exportToExcel(report) : await exportToPdf(report);
      if (result.saved) {
        setMessage(result.filePath ? `Saved to ${result.filePath}` : 'Report downloaded.');
      }
    } catch (caught) {
      setError(`Export failed: ${(caught as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  if (data.loading) return <Spinner label="Loading invoices…" />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Invoices</h1>
          <p>{BLURB[view]}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn"
            onClick={() => void runExport('excel')}
            disabled={exporting !== null || rows.length === 0}
          >
            <FileSpreadsheet size={15} />
            {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          <button
            className="btn"
            onClick={() => void runExport('pdf')}
            disabled={exporting !== null || rows.length === 0}
          >
            <FileText size={15} />
            {exporting === 'pdf' ? 'Exporting…' : customer ? 'Statement PDF' : 'PDF'}
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {message && <Banner tone="info">{message}</Banner>}

      {view === 'overdue' && rows.length > 0 && (
        <Banner tone="error">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {rows.length} invoice{rows.length === 1 ? '' : 's'} worth {formatCurrency(total)}{' '}
            {rows.length === 1 ? 'is' : 'are'} past due — the oldest by {oldest} days.
          </span>
        </Banner>
      )}

      <div className="tabs">
        {TABS.map((tab) => {
          const count =
            tab.id === 'overdue'
              ? summary.overdueCount
              : tab.id === 'due-soon'
                ? summary.dueThisWeekCount
                : tab.id === 'outstanding'
                  ? summary.outstandingCount
                  : 0;
          return (
            <button
              key={tab.id}
              className={view === tab.id ? 'tab active' : 'tab'}
              onClick={() => setParams(tab.id === 'outstanding' ? {} : { view: tab.id })}
            >
              {tab.label}
              {count > 0 && (
                <span className={tab.id === 'overdue' ? 'tab-count danger' : 'tab-count'}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="tiles">
        <Tile label="Invoices" value={String(rows.length)} />
        <Tile
          label="Total value"
          value={formatCurrency(total)}
          accent
          tone={view === 'overdue' && total > 0 ? 'negative' : undefined}
        />
        {view === 'overdue' && <Tile label="Oldest" value={oldest > 0 ? `${oldest} days` : '—'} />}
        {view !== 'paid' && (
          <Tile
            label="Avg days outstanding"
            value={summary.outstandingCount > 0 ? `${summary.averageDaysOutstanding} days` : '—'}
          />
        )}
      </div>

      <div style={{ height: 14 }} />

      <Card>
        <div className="filters">
          <Field label="Customer">
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">All customers</option>
              {data.customers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.companyName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search">
            <input
              placeholder="Customer or load number…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <button
            className="btn"
            onClick={() => {
              setCustomerId('');
              setSearch('');
            }}
            disabled={!customerId && !search}
          >
            <RotateCcw size={14} />
            Clear
          </button>
        </div>
        {customer && (
          <p className="help" style={{ marginTop: 10, marginBottom: 0 }}>
            Exporting now produces a statement for {customer.companyName} on{' '}
            {paymentTermsLabel(customer.paymentTermsDays)} terms.
          </p>
        )}
      </Card>

      <div style={{ height: 14 }} />

      <ReceivableTable
        receivables={rows}
        emptyTitle={
          view === 'overdue'
            ? 'Nothing overdue'
            : view === 'due-soon'
              ? 'Nothing due this week'
              : view === 'paid'
                ? 'Nothing paid yet'
                : 'Nothing outstanding'
        }
        emptyMessage={
          view === 'overdue'
            ? 'Every customer is inside their payment terms.'
            : view === 'due-soon'
              ? 'No invoices fall due in the next seven days.'
              : view === 'paid'
                ? 'Invoices appear here once a load reaches Customer Paid.'
                : 'Loads appear here once marked Completed or Billed.'
        }
        showDaysPastDue={view === 'overdue'}
      />
    </div>
  );
}

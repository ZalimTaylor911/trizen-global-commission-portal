import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, RotateCcw } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { SHIPMENT_STATUSES, SHIPMENT_TYPES, type ShipmentStatus, type ShipmentType } from '@/domain/types';
import type { DataSet } from '@/domain/engine';
import { formatCurrency } from '@/domain/money';
import { distinctMonths, distinctYears, monthLabel } from '@/lib/dates';
import {
  EMPTY_FILTERS,
  REPORT_KINDS,
  applyFilters,
  buildReport,
  type ReportFilters,
  type ReportKind,
} from '@/lib/reports';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPdf } from '@/lib/export/pdf';
import { Banner, Card, EmptyState, Field, Spinner } from '@/components/ui';

export default function Reports() {
  const data = useData();
  const [kind, setKind] = useState<ReportKind>('shipments');
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataset: DataSet = useMemo(
    () => ({
      shipments: data.shipments,
      agencies: data.agencies,
      partners: data.partners,
      expenses: data.expenses,
      withdrawals: data.withdrawals,
    }),
    [data.shipments, data.agencies, data.partners, data.expenses, data.withdrawals],
  );

  const filtered = useMemo(() => applyFilters(dataset, filters), [dataset, filters]);
  const report = useMemo(
    () => buildReport(kind, filtered, filters, data.expenseCategories),
    [kind, filtered, filters, data.expenseCategories],
  );

  const allMonths = useMemo(
    () => distinctMonths([...data.shipments, ...data.expenses, ...data.withdrawals]),
    [data.shipments, data.expenses, data.withdrawals],
  );
  const allYears = useMemo(
    () => distinctYears([...data.shipments, ...data.expenses, ...data.withdrawals]),
    [data.shipments, data.expenses, data.withdrawals],
  );

  const set = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  async function runExport(format: 'excel' | 'pdf') {
    setExporting(format);
    setMessage(null);
    setError(null);
    try {
      const result = format === 'excel' ? await exportToExcel(report) : await exportToPdf(report);
      if (result.saved) {
        setMessage(
          result.filePath ? `Saved to ${result.filePath}` : 'Report downloaded.',
        );
      }
    } catch (caught) {
      setError(`Export failed: ${(caught as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  if (data.loading) return <Spinner label="Loading data…" />;

  const sheet = report.sheets[0];
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>{REPORT_KINDS.find((option) => option.value === kind)?.description}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn"
            onClick={() => void runExport('excel')}
            disabled={exporting !== null || !sheet || sheet.rows.length === 0}
          >
            <FileSpreadsheet size={15} />
            {exporting === 'excel' ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            className="btn"
            onClick={() => void runExport('pdf')}
            disabled={exporting !== null || !sheet || sheet.rows.length === 0}
          >
            <FileText size={15} />
            {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {message && <Banner tone="info">{message}</Banner>}

      <Card>
        <Field label="Report">
          <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            {REPORT_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ height: 14 }} />

        <div className="filters">
          <Field label="Month">
            <select
              value={filters.month}
              onChange={(e) => setFilters((prev) => ({ ...prev, month: e.target.value, year: '' }))}
            >
              <option value="">All months</option>
              {allMonths.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Year">
            <select
              value={filters.year}
              onChange={(e) => setFilters((prev) => ({ ...prev, year: e.target.value, month: '' }))}
            >
              <option value="">All years</option>
              {allYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Agency">
            <select value={filters.agencyId} onChange={(e) => set('agencyId', e.target.value)}>
              <option value="">All agencies</option>
              {data.agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Partner">
            <select value={filters.partnerId} onChange={(e) => set('partnerId', e.target.value)}>
              <option value="">All partners</option>
              {data.partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status">
            <select
              value={filters.status}
              onChange={(e) => set('status', e.target.value as '' | ShipmentStatus)}
            >
              <option value="">All statuses</option>
              {SHIPMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Type">
            <select
              value={filters.shipmentType}
              onChange={(e) => set('shipmentType', e.target.value as '' | ShipmentType)}
            >
              <option value="">LTL and FTL</option>
              {SHIPMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Customer">
            <input
              placeholder="Company name…"
              value={filters.customer}
              onChange={(e) => set('customer', e.target.value)}
            />
          </Field>

          <Field label="Carrier">
            <input
              placeholder="Carrier name…"
              value={filters.carrier}
              onChange={(e) => set('carrier', e.target.value)}
            />
          </Field>

          <Field label="Lane">
            <input
              placeholder="Origin or destination…"
              value={filters.lane}
              onChange={(e) => set('lane', e.target.value)}
            />
          </Field>

          <button
            className="btn"
            onClick={() => setFilters(EMPTY_FILTERS)}
            disabled={activeFilterCount === 0}
          >
            <RotateCcw size={14} />
            Clear
          </button>
        </div>
      </Card>

      <div className="section-title">{report.title}</div>

      {report.summary && (
        <>
          <div className="tiles">
            {report.summary.map((item) => (
              <div className="tile" key={item.label}>
                <div className="label">{item.label}</div>
                <div className="value" style={{ fontSize: 18 }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: 14 }} />
        </>
      )}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {sheet?.columns.map((column) => (
                  <th key={column.header} className={column.numeric || column.currency ? 'num' : undefined}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(!sheet || sheet.rows.length === 0) && (
                <tr>
                  <td colSpan={sheet?.columns.length ?? 1}>
                    <EmptyState
                      title="Nothing to report"
                      message="No records match these filters. Try widening the period or clearing a filter."
                    />
                  </td>
                </tr>
              )}
              {sheet?.rows.slice(0, 300).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => {
                    const column = sheet.columns[cellIndex];
                    return (
                      <td key={cellIndex} className={column?.numeric || column?.currency ? 'num' : undefined}>
                        {column?.currency && typeof cell === 'number'
                          ? formatCurrency(cell)
                          : (cell ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {sheet?.totals && sheet.rows.length > 0 && (
              <tfoot>
                <tr>
                  {sheet.totals.map((cell, index) => {
                    const column = sheet.columns[index];
                    return (
                      <td key={index} className={column?.numeric || column?.currency ? 'num' : undefined}>
                        {column?.currency && typeof cell === 'number' ? formatCurrency(cell) : (cell ?? '')}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {sheet && sheet.rows.length > 300 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Showing the first 300 of {sheet.rows.length} rows on screen. The export contains all of
          them.
        </p>
      )}
    </div>
  );
}

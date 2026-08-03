import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileSpreadsheet, FileText, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { customersCol } from '@/firebase/collections';
import { deleteRecord } from '@/firebase/repository';
import { computeReceivables, computeCustomerAr } from '@/domain/receivables';
import { rankCustomers } from '@/domain/customers';
import { formatCurrency, round2 } from '@/domain/money';
import { paymentTermsLabel, type Customer } from '@/domain/types';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPdf } from '@/lib/export/pdf';
import { Banner, Card, ConfirmDialog, EmptyState, Field, Spinner } from '@/components/ui';
import CustomerForm, { EMPTY_CUSTOMER } from './CustomerForm';

export default function CustomerList({ openCreate = false }: { openCreate?: boolean }) {
  const { isAdmin, actor } = useAuth();
  const data = useData();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(openCreate);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const arByCustomer = useMemo(() => {
    const receivables = computeReceivables(data.shipments, data.customers);
    return new Map(computeCustomerAr(receivables).map((row) => [row.customerId, row]));
  }, [data.shipments, data.customers]);

  const loadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shipment of data.shipments) {
      counts.set(shipment.customerId, (counts.get(shipment.customerId) ?? 0) + 1);
    }
    return counts;
  }, [data.shipments]);

  const agencyById = useMemo(
    () => new Map(data.agencies.map((agency) => [agency.id, agency])),
    [data.agencies],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.customers.filter((customer) => {
      if (statusFilter === 'active' && !customer.active) return false;
      if (statusFilter === 'inactive' && customer.active) return false;
      if (agencyFilter && !customer.agencyIds.includes(agencyFilter)) return false;
      if (!needle) return true;
      return [customer.companyName, customer.poc, customer.email, customer.phone]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [data.customers, search, agencyFilter, statusFilter]);

  async function handleDelete() {
    if (!deleting || !actor) return;
    setBusy(true);
    try {
      await deleteRecord(customersCol, {
        entity: 'customer',
        label: deleting.companyName,
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

  /** Customer summary — loads, revenue, margin and what each one owes. */
  async function runExport(format: 'excel' | 'pdf') {
    setExporting(format);
    setError(null);
    try {
      const ranked = rankCustomers(data.customers, data.shipments, data.partners);
      const visible = new Set(filtered.map((customer) => customer.id));
      const rows = ranked.filter((row) => visible.has(row.customerId));

      const totals = rows.reduce(
        (acc, row) => ({
          loads: acc.loads + row.loads,
          revenue: acc.revenue + row.revenue,
          gross: acc.gross + row.grossMargin,
          net: acc.net + row.netMargin,
          outstanding: acc.outstanding + row.outstandingAr,
        }),
        { loads: 0, revenue: 0, gross: 0, net: 0, outstanding: 0 },
      );

      const report = {
        title: 'Customer Summary',
        subtitle: `${rows.length} customers with activity`,
        sheets: [
          {
            name: 'Customers',
            columns: [
              { header: 'Customer' },
              { header: 'Terms' },
              { header: 'Loads', numeric: true },
              { header: 'Revenue (AR)', numeric: true, currency: true },
              { header: 'Gross Margin', numeric: true, currency: true },
              { header: 'Net Margin (ours)', numeric: true, currency: true },
              { header: 'Outstanding AR', numeric: true, currency: true },
            ],
            rows: rows.map((row) => [
              row.customerName,
              paymentTermsLabel(
                data.customers.find((c) => c.id === row.customerId)?.paymentTermsDays ?? 30,
              ),
              row.loads,
              round2(row.revenue),
              round2(row.grossMargin),
              round2(row.netMargin),
              round2(row.outstandingAr),
            ]),
            totals: [
              `${rows.length} customers`,
              null,
              totals.loads,
              round2(totals.revenue),
              round2(totals.gross),
              round2(totals.net),
              round2(totals.outstanding),
            ],
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

  if (data.loading) return <Spinner label="Loading customers…" />;

  const activeFilters = [search, agencyFilter, statusFilter !== 'active' ? statusFilter : ''].filter(
    Boolean,
  ).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>
            {filtered.length} of {data.customers.length} customer
            {data.customers.length === 1 ? '' : 's'}. Payment terms here drive every due date in the
            portal.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn"
            onClick={() => void runExport('excel')}
            disabled={exporting !== null || filtered.length === 0}
          >
            <FileSpreadsheet size={15} />
            {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          <button
            className="btn"
            onClick={() => void runExport('pdf')}
            disabled={exporting !== null || filtered.length === 0}
          >
            <FileText size={15} />
            {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            New customer
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <Card>
        <div className="filters">
          <Field label="Search">
            <input
              placeholder="Name, contact, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Agency">
            <select value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)}>
              <option value="">All agencies</option>
              {data.agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="">All</option>
            </select>
          </Field>
          <button
            className="btn"
            onClick={() => {
              setSearch('');
              setAgencyFilter('');
              setStatusFilter('active');
            }}
            disabled={activeFilters === 0}
          >
            <RotateCcw size={14} />
            Clear
          </button>
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Terms</th>
                <th>Agencies</th>
                <th className="num">Loads</th>
                <th className="num">Outstanding</th>
                <th className="num">Overdue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title={data.customers.length === 0 ? 'No customers yet' : 'No matches'}
                      message={
                        data.customers.length === 0
                          ? 'Add the shippers you book loads for. Their payment terms set every invoice due date.'
                          : 'Try clearing a filter.'
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.map((customer) => {
                const ar = arByCustomer.get(customer.id);
                return (
                  <tr
                    key={customer.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/crm/customers/${customer.id}`)}
                  >
                    <td>
                      <Link
                        to={`/crm/customers/${customer.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}
                      >
                        {customer.companyName}
                      </Link>
                      {!customer.active && (
                        <span className="badge neutral" style={{ marginLeft: 8 }}>
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="muted">
                      {customer.poc || '—'}
                      {customer.email && <div>{customer.email}</div>}
                    </td>
                    <td className="nowrap">{paymentTermsLabel(customer.paymentTermsDays)}</td>
                    <td className="muted">
                      {customer.agencyIds.length === 0 ? (
                        <span className="badge neutral">Any</span>
                      ) : (
                        customer.agencyIds
                          .map((id) => agencyById.get(id)?.name ?? '—')
                          .join(', ')
                      )}
                    </td>
                    <td className="num">{loadCounts.get(customer.id) ?? 0}</td>
                    <td className="num">{formatCurrency(ar?.outstanding ?? 0)}</td>
                    <td className="num">
                      {(ar?.overdue ?? 0) > 0 ? (
                        <span className="badge danger">{formatCurrency(ar!.overdue)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button
                          className="btn ghost small"
                          onClick={() => setEditing(customer)}
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        {isAdmin && (
                          <button
                            className="btn ghost small"
                            onClick={() => setDeleting(customer)}
                            aria-label="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
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
        <CustomerForm
          initial={editing ?? EMPTY_CUSTOMER}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(id) => {
            if (!editing) navigate(`/crm/customers/${id}`);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete customer"
          message={
            (loadCounts.get(deleting.id) ?? 0) > 0
              ? `${deleting.companyName} is on ${loadCounts.get(deleting.id)} load(s). Deleting leaves those loads without a customer and drops their payment terms — mark the customer inactive instead unless you're sure.`
              : `Delete ${deleting.companyName}?`
          }
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </div>
  );
}

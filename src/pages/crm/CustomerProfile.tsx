import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, MapPin, Pencil, Phone, User } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { computeCustomerStats } from '@/domain/customers';
import { openReceivables } from '@/domain/receivables';
import { formatCurrency } from '@/domain/money';
import { paymentTermsLabel } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Banner, Card, EmptyState, Spinner, StatusBadge, Tile } from '@/components/ui';
import CustomerForm from './CustomerForm';
import ReceivableTable from './ReceivableTable';

export default function CustomerProfile() {
  const { customerId } = useParams<{ customerId: string }>();
  const data = useData();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const customer = data.customers.find((row) => row.id === customerId);

  const stats = useMemo(
    () => (customer ? computeCustomerStats(customer, data.shipments, data.partners) : null),
    [customer, data.shipments, data.partners],
  );

  const shipments = useMemo(
    () => data.shipments.filter((shipment) => shipment.customerId === customerId),
    [data.shipments, customerId],
  );

  const agencyNames = useMemo(() => {
    if (!customer) return [];
    const byId = new Map(data.agencies.map((agency) => [agency.id, agency]));
    return customer.agencyIds.map((id) => byId.get(id)?.name ?? 'Unknown agency');
  }, [customer, data.agencies]);

  if (data.loading) return <Spinner label="Loading customer…" />;

  if (!customer || !stats) {
    return (
      <div className="page">
        <button className="btn" onClick={() => navigate('/crm/customers')}>
          <ArrowLeft size={15} />
          Back to customers
        </button>
        <div style={{ height: 14 }} />
        <Card>
          <EmptyState
            title="Customer not found"
            message="It may have been deleted. Go back to the customer list to pick another."
          />
        </Card>
      </div>
    );
  }

  const open = openReceivables(stats.receivables);
  const overCreditLimit =
    customer.creditLimit !== null && stats.outstandingAr > customer.creditLimit;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button
            className="btn ghost small"
            onClick={() => navigate('/crm/customers')}
            style={{ marginBottom: 8, paddingLeft: 0 }}
          >
            <ArrowLeft size={14} />
            Customers
          </button>
          <h1>
            {customer.companyName}{' '}
            {!customer.active && <span className="badge neutral">Inactive</span>}
          </h1>
          <p>
            {paymentTermsLabel(customer.paymentTermsDays)} ·{' '}
            {agencyNames.length > 0 ? agencyNames.join(', ') : 'Any agency'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            Edit customer
          </button>
        </div>
      </div>

      {stats.overdueInvoices > 0 && (
        <Banner tone="error">
          {stats.overdueInvoices} overdue invoice{stats.overdueInvoices === 1 ? '' : 's'} worth{' '}
          {formatCurrency(stats.overdueAmount)}.
        </Banner>
      )}

      {overCreditLimit && (
        <Banner tone="warning">
          Outstanding balance of {formatCurrency(stats.outstandingAr)} is over the agreed credit
          limit of {formatCurrency(customer.creditLimit!)}.
        </Banner>
      )}

      <div className="section-title">Customer information</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card title="Contact">
          <div className="partner-rows">
            <div>
              <span>
                <User size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                Primary contact
              </span>
              <span>{customer.poc || '—'}</span>
            </div>
            <div>
              <span>
                <Phone size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                Phone
              </span>
              <span>{customer.phone || '—'}</span>
            </div>
            <div>
              <span>
                <Mail size={12} style={{ verticalAlign: -1, marginRight: 5 }} />
                Email
              </span>
              <span>{customer.email || '—'}</span>
            </div>
            <div>
              <span>Tax ID</span>
              <span>{customer.taxId || '—'}</span>
            </div>
            <div>
              <span>Credit limit</span>
              <span>
                {customer.creditLimit === null ? 'None' : formatCurrency(customer.creditLimit)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Addresses">
          <div className="stack">
            <div>
              <div className="label" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                <MapPin size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                BILLING
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                {customer.billingAddress || <span className="muted">Not recorded</span>}
              </div>
            </div>
            <div>
              <div className="label" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                <MapPin size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                SHIPPING
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                {customer.shippingAddress || <span className="muted">Not recorded</span>}
              </div>
            </div>
          </div>
        </Card>

        {customer.notes && (
          <Card title="Notes">
            <div style={{ whiteSpace: 'pre-wrap' }}>{customer.notes}</div>
          </Card>
        )}
      </div>

      <div className="section-title">Shipments</div>
      <div className="tiles">
        <Tile label="Total Loads" value={String(stats.totalLoads)} />
        <Tile label="This Month" value={String(stats.monthlyLoads)} />
        <Tile label="Active" value={String(stats.activeLoads)} hint="Booked, moving or delivered" />
        <Tile label="Completed" value={String(stats.completedLoads)} hint="Handed to invoicing" />
        <Tile label="Cancelled" value={String(stats.cancelledLoads)} hint="Dissolved, claim or TONU" />
      </div>

      <div className="section-title">Revenue</div>
      <div className="tiles">
        <Tile label="Total AR" value={formatCurrency(stats.totalAr)} />
        <Tile label="Total AP" value={formatCurrency(stats.totalAp)} />
        <Tile label="Gross Margin" value={formatCurrency(stats.totalGrossMargin)} />
        <Tile label="Net Margin — ours" value={formatCurrency(stats.totalNetMargin)} accent />
        <Tile
          label="Outstanding AR"
          value={formatCurrency(stats.outstandingAr)}
          tone={stats.outstandingAr > 0 ? 'negative' : undefined}
        />
        <Tile label="Paid AR" value={formatCurrency(stats.paidAr)} tone="positive" />
        <Tile label="Avg Margin / Load" value={formatCurrency(stats.averageMarginPerLoad)} />
      </div>

      <div className="section-title">Invoicing</div>
      <div className="tiles">
        <Tile label="Total Invoiced" value={String(stats.totalInvoiced)} />
        <Tile label="Paid" value={String(stats.paidInvoices)} tone="positive" />
        <Tile label="Outstanding" value={String(stats.outstandingInvoices)} />
        <Tile
          label="Overdue"
          value={String(stats.overdueInvoices)}
          tone={stats.overdueInvoices > 0 ? 'negative' : undefined}
        />
        <Tile
          label="Avg Payment Days"
          value={stats.paidInvoices > 0 ? `${stats.averagePaymentDays} days` : '—'}
          hint={`Terms are ${paymentTermsLabel(customer.paymentTermsDays)}`}
        />
      </div>

      <div className="section-title">Open invoices</div>
      <ReceivableTable
        receivables={open}
        emptyTitle="Nothing outstanding"
        emptyMessage={`${customer.companyName} has no unpaid invoices.`}
      />

      <div className="section-title">Load history</div>
      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Load #</th>
                <th>Lane</th>
                <th>Carrier</th>
                <th>Type</th>
                <th className="num">AR</th>
                <th className="num">Gross</th>
                <th className="num">Net (ours)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No loads yet"
                      message={`Book a shipment for ${customer.companyName} and it appears here.`}
                    />
                  </td>
                </tr>
              )}
              {shipments.slice(0, 100).map((shipment) => (
                <tr key={shipment.id}>
                  <td className="nowrap">{formatDate(shipment.date)}</td>
                  <td className="mono">{shipment.loadNumber || '—'}</td>
                  <td className="muted nowrap">{shipment.lane || '—'}</td>
                  <td className="muted">{shipment.carrierName || '—'}</td>
                  <td>
                    <span className="badge neutral">{shipment.shipmentType}</span>
                  </td>
                  <td className="num">{formatCurrency(shipment.ar)}</td>
                  <td className="num">{formatCurrency(shipment.grossMargin)}</td>
                  <td className="num">{formatCurrency(shipment.netMargin)}</td>
                  <td>
                    <StatusBadge status={shipment.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {shipments.length > 100 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Showing the 100 most recent of {shipments.length} loads.{' '}
          <Link to="/shipments">See all in Shipments →</Link>
        </p>
      )}

      {editing && <CustomerForm initial={customer} onClose={() => setEditing(false)} />}
    </div>
  );
}

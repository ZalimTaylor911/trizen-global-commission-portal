import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarClock } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useData } from '@/context/DataContext';
import {
  computeAgeing,
  computeArSummary,
  computeCustomerAr,
  computeReceivables,
  openReceivables,
} from '@/domain/receivables';
import { rankCustomers } from '@/domain/customers';
import { formatCurrency } from '@/domain/money';
import { Banner, Card, EmptyState, Spinner, Tile } from '@/components/ui';
import ChartFrame from '@/components/ChartFrame';
import { useChartPalette } from '@/context/ThemeContext';
import ReceivableTable from './ReceivableTable';



export default function CrmDashboard() {
  const data = useData();
  const palette = useChartPalette();
  // Ageing runs healthy → severe, so it needs its own ramp rather than the
  // categorical series colours.
  const ageingColours = [palette.series[0], '#f59e0b', '#f97316', palette.series[4], '#9f1239'];

  const receivables = useMemo(
    () => computeReceivables(data.shipments, data.customers),
    [data.shipments, data.customers],
  );
  const summary = useMemo(() => computeArSummary(receivables), [receivables]);
  const byCustomer = useMemo(() => computeCustomerAr(receivables), [receivables]);
  const ageing = useMemo(() => computeAgeing(receivables), [receivables]);
  const topCustomers = useMemo(
    () => rankCustomers(data.customers, data.shipments, data.partners).slice(0, 8),
    [data.customers, data.shipments, data.partners],
  );

  const overdue = useMemo(
    () =>
      openReceivables(receivables)
        .filter((r) => r.state === 'overdue')
        .sort((a, b) => b.daysPastDue - a.daysPastDue)
        .slice(0, 10),
    [receivables],
  );

  const dueSoon = useMemo(
    () =>
      openReceivables(receivables)
        .filter((r) => r.daysUntilDue >= 0 && r.daysUntilDue <= 7)
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
        .slice(0, 10),
    [receivables],
  );

  if (data.loading) return <Spinner label="Loading receivables…" />;

  const unlinked = data.shipments.filter((shipment) => !shipment.customerId).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>CRM dashboard</h1>
          <p>
            Receivables tracked from your customers' payment terms. Invoices are issued by your TMS —
            this is what's owed and what's slipping.
          </p>
        </div>
      </div>

      {summary.overdueCount > 0 && (
        <Banner tone="error">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>
              {summary.overdueCount} overdue invoice{summary.overdueCount === 1 ? '' : 's'} worth{' '}
              {formatCurrency(summary.overdueAmount)}.
            </strong>{' '}
            The oldest is {summary.worstDaysPastDue} days past due.{' '}
            <Link to="/crm/invoices?view=overdue" style={{ color: 'inherit', fontWeight: 600 }}>
              Review them →
            </Link>
          </span>
        </Banner>
      )}

      {summary.dueTodayCount > 0 && (
        <Banner tone="warning">
          <CalendarClock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {summary.dueTodayCount} invoice{summary.dueTodayCount === 1 ? '' : 's'} worth{' '}
            {formatCurrency(summary.dueTodayAmount)} fall{summary.dueTodayCount === 1 ? 's' : ''} due
            today.
          </span>
        </Banner>
      )}

      {unlinked > 0 && (
        <Banner tone="info">
          {unlinked} load{unlinked === 1 ? '' : 's'} {unlinked === 1 ? 'is' : 'are'} not linked to a
          customer, so {unlinked === 1 ? 'it falls' : 'they fall'} back to Net 30. Edit them and pick
          a customer to use the right terms.
        </Banner>
      )}

      <div className="section-title">Receivables</div>
      <div className="tiles">
        <Tile
          label="Total Outstanding AR"
          value={formatCurrency(summary.totalOutstanding)}
          hint={`${summary.outstandingCount} unpaid invoice${summary.outstandingCount === 1 ? '' : 's'}`}
          accent
        />
        <Tile
          label="Due Today"
          value={formatCurrency(summary.dueTodayAmount)}
          hint={`${summary.dueTodayCount} invoice${summary.dueTodayCount === 1 ? '' : 's'}`}
        />
        <Tile
          label="Due This Week"
          value={formatCurrency(summary.dueThisWeekAmount)}
          hint={`${summary.dueThisWeekCount} invoice${summary.dueThisWeekCount === 1 ? '' : 's'}`}
        />
        <Tile
          label="Overdue"
          value={formatCurrency(summary.overdueAmount)}
          hint={`${summary.overdueCount} invoice${summary.overdueCount === 1 ? '' : 's'}`}
          tone={summary.overdueAmount > 0 ? 'negative' : undefined}
        />
        <Tile
          label="Avg Days Outstanding"
          value={summary.outstandingCount > 0 ? `${summary.averageDaysOutstanding} days` : '—'}
          hint="How long money sits unpaid"
        />
      </div>

      {summary.outstandingCount > 0 && (
        <>
          <div className="section-title">Ageing</div>
          <Card>
            <ChartFrame height={240}>
              {({ width, height }) => (
                <BarChart width={width} height={height} data={ageing} margin={{ top: 6, right: 10, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={palette.axis} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke={palette.axis}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: number, _name, item) =>
                      [`${formatCurrency(value)} · ${item.payload.count} invoices`, 'Outstanding']
                    }
                  />
                  <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                    {ageing.map((bucket, index) => (
                      <Cell key={bucket.label} fill={ageingColours[index]} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ChartFrame>
          </Card>
        </>
      )}

      <div className="section-title">
        Overdue invoices
        <Link to="/crm/invoices?view=overdue" style={{ marginLeft: 10, fontWeight: 500, fontSize: 12 }}>
          View all <ArrowRight size={11} style={{ verticalAlign: -1 }} />
        </Link>
      </div>
      <ReceivableTable
        receivables={overdue}
        emptyTitle="Nothing overdue"
        emptyMessage="Every customer is inside their payment terms."
      />

      <div className="section-title">
        Due in the next seven days
        <Link to="/crm/invoices?view=due-soon" style={{ marginLeft: 10, fontWeight: 500, fontSize: 12 }}>
          View all <ArrowRight size={11} style={{ verticalAlign: -1 }} />
        </Link>
      </div>
      <ReceivableTable
        receivables={dueSoon}
        emptyTitle="Nothing due this week"
        emptyMessage="No invoices fall due in the next seven days."
        showDaysPastDue={false}
      />

      <div className="section-title">Who owes the most</div>
      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Open invoices</th>
                <th className="num">Outstanding</th>
                <th className="num">Overdue</th>
                <th className="num">Worst</th>
              </tr>
            </thead>
            <tbody>
              {byCustomer.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      title="Nothing outstanding"
                      message="Balances appear here once loads reach Completed or Billed."
                    />
                  </td>
                </tr>
              )}
              {byCustomer.slice(0, 10).map((row) => (
                <tr key={row.customerId || row.customerName}>
                  <td>
                    {row.customerId ? (
                      <Link
                        to={`/crm/customers/${row.customerId}`}
                        style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 550 }}
                      >
                        {row.customerName}
                      </Link>
                    ) : (
                      row.customerName
                    )}
                  </td>
                  <td className="num">{row.openCount}</td>
                  <td className="num">{formatCurrency(row.outstanding)}</td>
                  <td className="num">
                    {row.overdue > 0 ? (
                      <span className="badge danger">{formatCurrency(row.overdue)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num muted">
                    {row.worstDaysPastDue > 0 ? `${row.worstDaysPastDue}d` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="section-title">Top customers by revenue</div>
      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="num">Loads</th>
                <th className="num">Revenue</th>
                <th className="num">Gross margin</th>
                <th className="num">Net margin</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      title="No customer activity yet"
                      message="Link loads to customers and their revenue shows up here."
                    />
                  </td>
                </tr>
              )}
              {topCustomers.map((row) => (
                <tr key={row.customerId}>
                  <td>
                    <Link
                      to={`/crm/customers/${row.customerId}`}
                      style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 550 }}
                    >
                      {row.customerName}
                    </Link>
                  </td>
                  <td className="num">{row.loads}</td>
                  <td className="num">{formatCurrency(row.revenue)}</td>
                  <td className="num">{formatCurrency(row.grossMargin)}</td>
                  <td className="num">{formatCurrency(row.netMargin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

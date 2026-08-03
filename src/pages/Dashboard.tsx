import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import {
  computeAgencySummaries,
  computeFinancialSummary,
  computeLedgers,
  computeMonthlySummaries,
  computeOperationsSummary,
  validatePartnerShares,
  type DataSet,
} from '@/domain/engine';
import { computeArSummary, computeReceivables, openReceivables } from '@/domain/receivables';
import { rankCustomers } from '@/domain/customers';
import { computeNotifications } from '@/domain/notifications';
import { formatCurrency, formatPercent, round2 } from '@/domain/money';
import { Banner, Card, EmptyState, Money, Spinner, Tile } from '@/components/ui';
import ChartFrame from '@/components/ChartFrame';
import { useChartPalette } from '@/context/ThemeContext';
import { formatDate, monthLabel } from '@/lib/dates';



function shortMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

export default function Dashboard() {
  const { isAdmin, profile } = useAuth();
  const data = useData();
  const palette = useChartPalette();

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

  const summary = useMemo(() => computeFinancialSummary(dataset), [dataset]);
  const operations = useMemo(() => computeOperationsSummary(data.shipments), [data.shipments]);
  const ledgers = useMemo(() => computeLedgers(dataset), [dataset]);
  const monthly = useMemo(() => computeMonthlySummaries(dataset), [dataset]);
  const agencies = useMemo(() => computeAgencySummaries(dataset), [dataset]);
  const issues = useMemo(() => validatePartnerShares(data.partners), [data.partners]);

  const receivables = useMemo(
    () => computeReceivables(data.shipments, data.customers),
    [data.shipments, data.customers],
  );
  const ar = useMemo(() => computeArSummary(receivables), [receivables]);
  const notifications = useMemo(
    () => computeNotifications(dataset, data.customers),
    [dataset, data.customers],
  );
  const topCustomers = useMemo(
    () => rankCustomers(data.customers, data.shipments, data.partners).slice(0, 6),
    [data.customers, data.shipments, data.partners],
  );

  const upcoming = useMemo(
    () =>
      openReceivables(receivables)
        .filter((r) => r.daysUntilDue >= 0)
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
        .slice(0, 6),
    [receivables],
  );

  const expenseBreakdown = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const expense of data.expenses) {
      const name =
        data.expenseCategories.find((category) => category.id === expense.categoryId)?.name ??
        'Uncategorised';
      byCategory.set(name, round2((byCategory.get(name) ?? 0) + expense.amount));
    }
    return [...byCategory.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [data.expenses, data.expenseCategories]);

  if (data.loading) return <Spinner label="Loading your books…" />;

  if (!isAdmin) {
    return <PartnerDashboard ledgers={ledgers} partnerId={profile?.partnerId} />;
  }

  const trend = [...monthly]
    .slice(0, 12)
    .reverse()
    .map((month) => ({
      month: monthLabel(month.month).replace(' 20', " '"),
      Revenue: month.revenue,
      'Gross profit': month.grossMargin,
      'Net profit': month.netMargin,
      Loads: month.loadsMoved,
    }));

  const currentMonth = monthly[0];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>
            {summary.totalLoads} load{summary.totalLoads === 1 ? '' : 's'} on file ·{' '}
            {operations.activeLoads} active · {summary.earnedLoads} paid by the agency
          </p>
        </div>
      </div>

      {data.error && <Banner tone="error">{data.error}</Banner>}
      {issues.map((issue) => (
        <Banner key={issue.message} tone={issue.level === 'error' ? 'error' : 'warning'}>
          {issue.message}
        </Banner>
      ))}

      {notifications.length > 0 && (
        <>
          <div className="section-title">Needs attention</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {notifications.map((notification) => (
              <Link
                key={notification.id}
                to={notification.link}
                className={`alert-card ${notification.severity}`}
              >
                <strong>{notification.title}</strong>
                <span>{notification.detail}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Operations</div>
      <div className="tiles">
        <Tile label="Active Loads" value={String(operations.activeLoads)} hint="Booked through delivered" accent />
        <Tile label="Assigned" value={String(operations.assigned)} />
        <Tile label="In Transit" value={String(operations.inTransit)} />
        <Tile label="Delivered" value={String(operations.delivered)} hint="Awaiting POD / completion" />
        <Tile label="Completed" value={String(operations.completed)} hint="Ready for invoicing" />
        <Tile label="Billed" value={String(operations.billed)} hint="Invoiced, awaiting payment" />
        <Tile label="Customer Paid" value={String(operations.customerPaid)} hint="Awaiting agency" />
        <Tile label="Agency Paid" value={String(operations.agencyPaid)} tone="positive" />
        <Tile
          label="Claims"
          value={String(operations.claims)}
          tone={operations.claims > 0 ? 'negative' : undefined}
        />
        <Tile
          label="Issues / Disputes"
          value={String(operations.disputes)}
          tone={operations.disputes > 0 ? 'negative' : undefined}
        />
      </div>

      <div className="section-title">Finance</div>
      <div className="tiles">
        <Tile
          label="Monthly Revenue"
          value={formatCurrency(currentMonth?.revenue ?? 0)}
          hint={currentMonth ? monthLabel(currentMonth.month) : 'No activity yet'}
        />
        <Tile
          label="Gross Profit"
          value={formatCurrency(summary.totalGrossMargin)}
          hint={`${formatPercent(summary.grossMarginPercent)} of revenue`}
        />
        <Tile label="Agency Earnings" value={formatCurrency(summary.totalAgencyCommission)} />
        <Tile
          label="Net Profit — team"
          value={formatCurrency(summary.totalNetMargin)}
          accent
          hint="Distributed to partners"
        />
        <Tile
          label="Outstanding AR"
          value={formatCurrency(ar.totalOutstanding)}
          hint={`${ar.outstandingCount} unpaid · avg ${ar.averageDaysOutstanding} days`}
          tone={ar.overdueAmount > 0 ? 'negative' : undefined}
        />
        <Tile
          label="Paid AR"
          value={formatCurrency(
            round2(
              data.shipments
                .filter((s) => s.status === 'Customer Paid' || s.status === 'Agency Paid')
                .reduce((total, s) => total + s.ar, 0),
            ),
          )}
          tone="positive"
        />
        <Tile label="Total Expenses" value={formatCurrency(summary.totalExpenses)} />
        <Tile label="Total Withdrawals" value={formatCurrency(summary.totalWithdrawals)} />
        <Tile
          label="Available Balance"
          value={formatCurrency(summary.totalOutstandingBalance)}
          hint="Owed to partners, not yet drawn"
          tone={summary.totalOutstandingBalance < 0 ? 'negative' : 'positive'}
          accent
        />
        <Tile
          label="Pipeline"
          value={formatCurrency(summary.pipelineNetMargin)}
          hint={`${summary.pipelineLoads} loads awaiting agency payment`}
        />
      </div>

      {trend.length > 0 && (
        <>
          <div className="section-title">Revenue and profit trend</div>
          <Card>
            <ChartFrame>
              {({ width, height }) => (
                <ComposedChart width={width} height={height} data={trend} margin={{ top: 6, right: 10, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={palette.axis} />
                  <YAxis tick={{ fontSize: 11 }} stroke={palette.axis} tickFormatter={shortMoney} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Revenue" fill={palette.series[6]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Gross profit" fill={palette.series[1]} radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="Net profit" stroke={palette.series[0]} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              )}
            </ChartFrame>
          </Card>

          <div className="section-title">Loads moved per month</div>
          <Card>
            <ChartFrame height={220}>
              {({ width, height }) => (
                <BarChart width={width} height={height} data={trend} margin={{ top: 6, right: 10, left: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke={palette.axis} />
                  <YAxis tick={{ fontSize: 11 }} stroke={palette.axis} allowDecimals={false} />
                  <Tooltip formatter={(value: number) => `${value} loads`} />
                  <Bar dataKey="Loads" fill={palette.series[0]} radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ChartFrame>
          </Card>
        </>
      )}

      <div className="section-title">Partner earnings</div>
      {ledgers.length === 0 ? (
        <Card>
          <EmptyState
            title="No partners yet"
            message="Add your partners and their share percentages to start distributing commission."
          />
        </Card>
      ) : (
        <>
          <div className="partner-cards">
            {ledgers.map((ledger) => (
              <div className="partner-card" key={ledger.partnerId}>
                <header>
                  <strong>{ledger.partnerName}</strong>
                  <span className={ledger.bearsOperationalExpenses ? 'badge info' : 'badge neutral'}>
                    {formatPercent(ledger.sharePercent)}
                    {ledger.bearsOperationalExpenses ? '' : ' · silent'}
                  </span>
                </header>
                <div className="partner-rows">
                  <div>
                    <span>Total earned</span>
                    <span>{formatCurrency(ledger.totalEarned)}</span>
                  </div>
                  <div>
                    <span>Expenses deducted</span>
                    <span>−{formatCurrency(ledger.operationalExpenses)}</span>
                  </div>
                  <div>
                    <span>Agency deductions</span>
                    <span>−{formatCurrency(ledger.agencyDeductions)}</span>
                  </div>
                  <div>
                    <span>Withdrawals</span>
                    <span>−{formatCurrency(ledger.withdrawals)}</span>
                  </div>
                  <div className="total">
                    <span>Current balance</span>
                    <Money amount={ledger.balance} colour />
                  </div>
                  <div>
                    <span>Pending (in pipeline)</span>
                    <span className="muted">{formatCurrency(ledger.pendingBalance)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ height: 14 }} />
          <Card title="Earnings by partner">
            <ChartFrame height={230}>
              {({ width, height }) => (
                <BarChart width={width} height={height}
                  data={ledgers.map((ledger) => ({
                    name: ledger.partnerName,
                    Earned: ledger.totalEarned,
                    Balance: ledger.balance,
                    Pending: ledger.pendingBalance,
                  }))}
                  margin={{ top: 6, right: 10, left: 6, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke={palette.axis} />
                  <YAxis tick={{ fontSize: 11 }} stroke={palette.axis} tickFormatter={shortMoney} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Earned" fill={palette.series[1]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Balance" fill={palette.series[0]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Pending" fill={palette.series[6]} radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ChartFrame>
          </Card>
        </>
      )}

      <div className="section-title">Customer insights</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
        <Card title="Top customers by revenue" flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="num">Loads</th>
                  <th className="num">Revenue</th>
                  <th className="num">Net margin</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        title="No customer activity"
                        message="Link loads to customers and they appear here."
                      />
                    </td>
                  </tr>
                )}
                {topCustomers.map((row) => (
                  <tr key={row.customerId}>
                    <td>
                      <Link to={`/crm/customers/${row.customerId}`}>{row.customerName}</Link>
                    </td>
                    <td className="num">{row.loads}</td>
                    <td className="num">{formatCurrency(row.revenue)}</td>
                    <td className="num">{formatCurrency(row.netMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Upcoming due dates" flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Invoice / Load</th>
                  <th>Due</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState title="Nothing due" message="No invoices are approaching their due date." />
                    </td>
                  </tr>
                )}
                {upcoming.map((row) => (
                  <tr key={row.shipmentId}>
                    <td>{row.customerName}</td>
                    <td className="mono">{row.loadNumber || '—'}</td>
                    <td className="nowrap">
                      {formatDate(row.dueDate)}{' '}
                      <span className="muted">
                        ({row.daysUntilDue === 0 ? 'today' : `${row.daysUntilDue}d`})
                      </span>
                    </td>
                    <td className="num">{formatCurrency(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {expenseBreakdown.length > 0 && (
        <>
          <div className="section-title">Expense breakdown</div>
          <Card>
            <ChartFrame height={240}>
              {({ width, height }) => (
                <PieChart width={width} height={height}>
                  <Pie
                    data={expenseBreakdown}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={84}
                    paddingAngle={2}
                  >
                    {expenseBreakdown.map((entry, index) => (
                      <Cell key={entry.name} fill={palette.series[index % palette.series.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              )}
            </ChartFrame>
          </Card>
        </>
      )}

      <div className="section-title">Agencies</div>
      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Split (team / agency)</th>
                <th className="num">Loads</th>
                <th className="num">Gross Margin</th>
                <th className="num">Agency Earnings</th>
                <th className="num">Team Earnings</th>
              </tr>
            </thead>
            <tbody>
              {agencies.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No agencies yet"
                      message="Add the brokerages you work with and their commission splits."
                    />
                  </td>
                </tr>
              )}
              {agencies.map((agency) => (
                <tr key={agency.agencyId}>
                  <td>{agency.agencyName}</td>
                  <td className="muted nowrap">
                    {formatPercent(agency.agentPercent)} / {formatPercent(agency.agencyPercent)}
                  </td>
                  <td className="num">{agency.totalLoads}</td>
                  <td className="num">{formatCurrency(agency.grossMargin)}</td>
                  <td className="num">{formatCurrency(agency.agencyEarnings)}</td>
                  <td className="num">{formatCurrency(agency.teamEarnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="section-title">Monthly summary</div>
      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Loads</th>
                <th className="num">Revenue</th>
                <th className="num">Gross Margin</th>
                <th className="num">Net Margin</th>
                <th className="num">Expenses</th>
                <th className="num">Withdrawals</th>
                <th className="num">Remaining Balance</th>
              </tr>
            </thead>
            <tbody>
              {monthly.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="Nothing recorded yet"
                      message="Months appear here once shipments, expenses or withdrawals are added."
                    />
                  </td>
                </tr>
              )}
              {monthly.map((month) => (
                <tr key={month.month}>
                  <td className="nowrap">{monthLabel(month.month)}</td>
                  <td className="num">{month.loadsMoved}</td>
                  <td className="num">{formatCurrency(month.revenue)}</td>
                  <td className="num">{formatCurrency(month.grossMargin)}</td>
                  <td className="num">{formatCurrency(month.netMargin)}</td>
                  <td className="num">{formatCurrency(month.expenses)}</td>
                  <td className="num">{formatCurrency(month.withdrawals)}</td>
                  <td className="num">
                    <Money amount={month.remainingBalance} colour />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PartnerDashboard({
  ledgers,
  partnerId,
}: {
  ledgers: ReturnType<typeof computeLedgers>;
  partnerId: string | undefined;
}) {
  const mine = ledgers.find((ledger) => ledger.partnerId === partnerId);

  if (!mine) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>My earnings</h1>
        </div>
        <Card>
          <EmptyState
            title="No partner record found"
            message="Your login isn't linked to an active partner. Ask Shabbir to check the Partners screen."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>My earnings</h1>
          <p>
            Your share is {formatPercent(mine.sharePercent)} of the team's net margin. Figures update
            live as shipments are marked Agency Paid.
          </p>
        </div>
      </div>

      <div className="tiles">
        <Tile label="Total Earned" value={formatCurrency(mine.totalEarned)} />
        <Tile label="Expenses Deducted" value={formatCurrency(mine.operationalExpenses)} />
        <Tile label="Agency Deductions" value={formatCurrency(mine.agencyDeductions)} />
        <Tile label="Withdrawals" value={formatCurrency(mine.withdrawals)} />
        <Tile
          label="Current Balance"
          value={formatCurrency(mine.balance)}
          tone={mine.balance < 0 ? 'negative' : 'positive'}
          accent
        />
        <Tile
          label="Pending"
          value={formatCurrency(mine.pendingBalance)}
          hint="Your share of loads not yet paid by the agency"
        />
      </div>
    </div>
  );
}

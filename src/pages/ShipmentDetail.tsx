import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Circle, Pencil } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { splitShipment } from '@/domain/engine';
import { computeReceivable } from '@/domain/receivables';
import { actualTransitDays, deliveryPerformance } from '@/domain/transit';
import { formatCurrency, round2 } from '@/domain/money';
import { paymentTermsLabel, type ShipmentStatus } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Banner, Card, EmptyState, Money, Spinner, StatusBadge, Tile } from '@/components/ui';

/**
 * The operational path a load walks. Claim, Dissolved, TONU and Issue/Dispute
 * are exceptions rather than steps, so they're flagged separately rather than
 * shoehorned into the timeline.
 */
const TIMELINE: { status: ShipmentStatus; caption: string }[] = [
  { status: 'Assigned', caption: 'Booked with a carrier' },
  { status: 'In Transit', caption: 'Picked up and rolling' },
  { status: 'Delivered', caption: 'Arrived at the consignee' },
  { status: 'Completed', caption: 'POD in the TMS, ready to invoice' },
  { status: 'Billed', caption: 'Invoiced to the customer' },
  { status: 'Customer Paid', caption: 'Customer settled the invoice' },
  { status: 'Agency Paid', caption: 'Agency paid us — commission earned' },
];

const EXCEPTION_STATUSES: ShipmentStatus[] = ['Claim', 'Dissolved', 'TONU', 'Issue / Dispute'];

export default function ShipmentDetail() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const { isAdmin } = useAuth();
  const data = useData();
  const navigate = useNavigate();

  const shipment = data.shipments.find((row) => row.id === shipmentId);
  const agency = data.agencies.find((row) => row.id === shipment?.agencyId);
  const customer = data.customers.find((row) => row.id === shipment?.customerId);

  const split = useMemo(
    () => (shipment ? splitShipment(shipment, data.partners) : null),
    [shipment, data.partners],
  );

  const receivable = useMemo(
    () => (shipment ? computeReceivable(shipment, customer) : null),
    [shipment, customer],
  );

  /** Agency deductions booked against this specific load. */
  const deductions = useMemo(
    () => data.expenses.filter((expense) => expense.shipmentId === shipmentId),
    [data.expenses, shipmentId],
  );

  if (data.loading) return <Spinner label="Loading shipment…" />;

  if (!shipment || !split || !receivable) {
    return (
      <div className="page">
        <button className="btn" onClick={() => navigate('/shipments')}>
          <ArrowLeft size={15} />
          Back to shipments
        </button>
        <div style={{ height: 14 }} />
        <Card>
          <EmptyState
            title="Shipment not found"
            message="It may have been deleted. Go back to the list to pick another."
          />
        </Card>
      </div>
    );
  }

  const isException = EXCEPTION_STATUSES.includes(shipment.status);
  const reachedIndex = TIMELINE.findIndex((step) => step.status === shipment.status);
  // A load past Customer Paid has, by definition, been through everything before it.
  const currentIndex = isException ? -1 : reachedIndex;

  const performance = deliveryPerformance(shipment);
  const transitTaken = actualTransitDays(
    shipment.actualPickupDate,
    shipment.actualDeliveryDate,
    shipment.shipmentType,
  );

  const deductionTotal = round2(deductions.reduce((sum, expense) => sum + expense.amount, 0));
  const profitAfterDeductions = round2(split.teamCommission - deductionTotal);
  const earned = shipment.status === 'Agency Paid';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <button
            className="btn ghost small"
            onClick={() => navigate('/shipments')}
            style={{ marginBottom: 8, paddingLeft: 0 }}
          >
            <ArrowLeft size={14} />
            Shipments
          </button>
          <h1>
            {shipment.loadNumber || 'Load'} <StatusBadge status={shipment.status} />
          </h1>
          <p>
            {customer ? (
              <Link to={`/crm/customers/${customer.id}`}>{customer.companyName}</Link>
            ) : (
              shipment.companyName
            )}{' '}
            · {shipment.lane || 'No lane recorded'} · {shipment.shipmentType}
          </p>
        </div>
        {isAdmin && (
          <div className="page-actions">
            <button className="btn" onClick={() => navigate('/shipments', { state: { edit: shipment.id } })}>
              <Pencil size={15} />
              Edit in list
            </button>
          </div>
        )}
      </div>

      {isException && (
        <Banner tone="error">
          This load is marked <strong>{shipment.status}</strong>. No commission is earned and it
          isn't chased as a receivable
          {shipment.status === 'Issue / Dispute' ? ' — except it stays in outstanding AR.' : '.'}
        </Banner>
      )}

      {receivable.state === 'overdue' && (
        <Banner tone="warning">
          Invoiced {formatDate(receivable.invoicedDate)} as{' '}
          <strong>{shipment.loadNumber || 'this load'}</strong>, due{' '}
          {formatDate(receivable.dueDate)} — {receivable.daysPastDue} days past due.
        </Banner>
      )}

      <div className="section-title">Financials</div>
      <div className="tiles">
        <Tile label="AR — customer pays" value={formatCurrency(shipment.ar)} />
        <Tile label="AP — carrier paid" value={formatCurrency(shipment.ap)} />
        <Tile label="Gross margin" value={formatCurrency(shipment.grossMargin)} />
        <Tile
          label={`${agency?.name ?? 'Agency'} keeps`}
          value={formatCurrency(round2(shipment.grossMargin - shipment.netMargin))}
          hint={agency ? `${agency.agencyPercent}% of gross` : undefined}
        />
        <Tile
          label="Net margin — ours"
          value={formatCurrency(shipment.netMargin)}
          hint={agency ? `${agency.agentPercent}% of gross` : undefined}
          accent
        />
        <Tile
          label={earned ? 'Commission earned' : 'Commission pending'}
          value={formatCurrency(split.teamCommission)}
          hint={earned ? 'Credited to partners' : 'Credits at Agency Paid'}
          tone={earned ? 'positive' : undefined}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 14 }}>
        <Card title="Partner distribution">
          {earned ? (
            <div className="partner-rows">
              {data.partners
                .filter((partner) => partner.active)
                .map((partner) => (
                  <div key={partner.id}>
                    <span>
                      {partner.name} · {partner.sharePercent}%
                    </span>
                    <span>{formatCurrency(split.partnerEarnings[partner.id] ?? 0)}</span>
                  </div>
                ))}
              <div className="total">
                <span>Total distributed</span>
                <span>{formatCurrency(split.teamCommission)}</span>
              </div>
            </div>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Nothing is credited until this load reaches <strong>Agency Paid</strong>. It would
                distribute as:
              </p>
              <div className="partner-rows">
                {data.partners
                  .filter((partner) => partner.active)
                  .map((partner) => (
                    <div key={partner.id}>
                      <span>
                        {partner.name} · {partner.sharePercent}%
                      </span>
                      <span className="muted">
                        {formatCurrency(round2((shipment.netMargin * partner.sharePercent) / 100))}
                      </span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </Card>

        <Card title="Deductions against this load">
          {deductions.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No agency deductions booked against this load.
            </p>
          ) : (
            <div className="partner-rows">
              {deductions.map((expense) => (
                <div key={expense.id}>
                  <span>
                    {formatDate(expense.date)} · {expense.notes || 'Deduction'}
                  </span>
                  <span>−{formatCurrency(expense.amount)}</span>
                </div>
              ))}
              <div className="total">
                <span>Net after deductions</span>
                <Money amount={profitAfterDeductions} colour />
              </div>
            </div>
          )}
          <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
            Operational expenses and withdrawals are shared across the business rather than charged
            to one load, so they appear on the dashboard rather than here.
          </p>
        </Card>
      </div>

      <div className="section-title">Timeline</div>
      <Card>
        {isException ? (
          <p className="muted" style={{ margin: 0 }}>
            This load left the normal workflow at <strong>{shipment.status}</strong>.
          </p>
        ) : (
          <ol className="timeline">
            {TIMELINE.map((step, index) => {
              const done = currentIndex >= 0 && index <= currentIndex;
              const current = index === currentIndex;
              return (
                <li
                  key={step.status}
                  className={done ? (current ? 'done current' : 'done') : undefined}
                >
                  <span className="timeline-marker">
                    {done ? <Check size={12} /> : <Circle size={8} />}
                  </span>
                  <div>
                    <strong>{step.status}</strong>
                    <div className="muted">{step.caption}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="section-title">Transit</div>
      <div className="tiles">
        <Tile label="Service" value={shipment.shipmentType} hint={shipment.lane || undefined} />
        <Tile
          label="Transit days quoted"
          value={
            shipment.transitDays > 0
              ? `${shipment.transitDays} ${shipment.shipmentType === 'LTL' ? 'business' : 'calendar'}`
              : '—'
          }
        />
        <Tile
          label="Actual pickup"
          value={shipment.actualPickupDate ? formatDate(shipment.actualPickupDate) : '—'}
        />
        <Tile
          label="Estimated delivery"
          value={shipment.estimatedDeliveryDate ? formatDate(shipment.estimatedDeliveryDate) : '—'}
        />
        <Tile
          label="Actual delivery"
          value={shipment.actualDeliveryDate ? formatDate(shipment.actualDeliveryDate) : '—'}
          hint={
            performance.state === 'on-time'
              ? 'On time'
              : performance.state === 'early'
                ? `${performance.daysDifference} day(s) early`
                : performance.state === 'late'
                  ? `${performance.daysDifference} day(s) late`
                  : undefined
          }
          tone={
            performance.state === 'late'
              ? 'negative'
              : performance.state === 'on-time' || performance.state === 'early'
                ? 'positive'
                : undefined
          }
        />
        <Tile
          label="Transit taken"
          value={transitTaken === null ? '—' : `${transitTaken} days`}
        />
      </div>

      <div className="section-title">Invoicing</div>
      <div className="tiles">
        <Tile
          label="Invoice / load number"
          value={shipment.loadNumber || '—'}
          hint="Billed to the customer under this number"
        />
        <Tile
          label="Invoice date"
          value={formatDate(receivable.invoicedDate)}
          hint={shipment.invoicedDate ? undefined : 'Falling back to the load date'}
        />
        <Tile
          label="Due date"
          value={formatDate(receivable.dueDate)}
          hint={paymentTermsLabel(receivable.paymentTermsDays)}
        />
        <Tile
          label="Receivable"
          value={
            receivable.state === 'not-invoiced'
              ? 'Not yet invoiced'
              : receivable.state === 'settled'
                ? 'Paid'
                : receivable.state === 'written-off'
                  ? 'Written off'
                  : receivable.state === 'overdue'
                    ? `${receivable.daysPastDue} days late`
                    : `Due in ${receivable.daysUntilDue} days`
          }
          tone={
            receivable.state === 'overdue'
              ? 'negative'
              : receivable.state === 'settled'
                ? 'positive'
                : undefined
          }
        />
      </div>

      <div className="section-title">Load details</div>
      <Card>
        <div className="partner-rows">
          <div>
            <span>Load number</span>
            <span className="mono">{shipment.loadNumber || '—'}</span>
          </div>
          <div>
            <span>Date</span>
            <span>{formatDate(shipment.date)}</span>
          </div>
          <div>
            <span>Customer</span>
            <span>{customer?.companyName ?? shipment.companyName}</span>
          </div>
          <div>
            <span>POC</span>
            <span>{shipment.poc || '—'}</span>
          </div>
          <div>
            <span>Lane</span>
            <span>{shipment.lane || '—'}</span>
          </div>
          <div>
            <span>Carrier</span>
            <span>{shipment.carrierName || '—'}</span>
          </div>
          <div>
            <span>Agency</span>
            <span>
              {agency ? `${agency.name} (${agency.agentPercent}/${agency.agencyPercent})` : '—'}
            </span>
          </div>
        </div>

        {shipment.notes && (
          <>
            <div className="section-title" style={{ marginTop: 18 }}>
              Notes
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{shipment.notes}</div>
          </>
        )}
      </Card>

    </div>
  );
}
